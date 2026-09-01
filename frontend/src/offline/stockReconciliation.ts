import { openBaannoiPosDatabase, type OfflineOrder } from './database';

export const STOCK_REVIEW_HEADING = 'ต้องตรวจสอบสต็อก';
export const STOCK_REVIEW_MESSAGE = 'Sync ออฟไลน์แล้ว แต่สต็อกบนระบบไม่พอ · กรุณาตรวจนับของจริงแล้วยืนยัน';

export interface StockReviewEntry {
  productId: number;
  productName: string;
  /** Units the server could not deduct, summed across every unresolved sale. */
  discrepancy: number;
  /** Local orders contributing to this discrepancy, oldest first. */
  localOrderIds: string[];
}

function unresolvedShortfalls(order: OfflineOrder) {
  const resolved = new Set(order.stockReviewResolvedProductIds ?? []);
  return (order.stockShortfalls ?? []).filter((entry) => !resolved.has(entry.productId));
}

/**
 * Aggregates every outstanding shortfall by product.
 *
 * Each order contributes its own shortfall exactly once, and only until that
 * product has been counted — so two offline sales of the same product add up
 * rather than double-counting or overwriting one another.
 */
export async function getPendingStockReviews(): Promise<StockReviewEntry[]> {
  const database = await openBaannoiPosDatabase();
  try {
    const orders = await database.getAllFromIndex('offlineOrders', 'by-created-at');
    const byProduct = new Map<number, StockReviewEntry>();
    for (const order of orders) {
      if (!order.stockReview) continue;
      for (const shortfall of unresolvedShortfalls(order)) {
        const entry = byProduct.get(shortfall.productId) ?? {
          productId: shortfall.productId,
          productName: shortfall.productName,
          discrepancy: 0,
          localOrderIds: [],
        };
        entry.discrepancy += shortfall.shortfall;
        entry.localOrderIds.push(order.localOrderId);
        byProduct.set(shortfall.productId, entry);
      }
    }
    return [...byProduct.values()].sort((left, right) => left.productName.localeCompare(right.productName));
  } finally {
    database.close();
  }
}

export async function getPendingStockReviewCount(): Promise<number> {
  return (await getPendingStockReviews()).length;
}

/**
 * Marks one product's review settled on every order that raised it.
 *
 * Additive by design: `stockReview` and `stockShortfalls` are left in place so
 * the history of what happened survives, and only the resolution is recorded.
 */
export async function resolveStockReview(
  productId: number,
  resolvedAt = new Date().toISOString(),
): Promise<number> {
  const database = await openBaannoiPosDatabase();
  const transaction = database.transaction('offlineOrders', 'readwrite');
  try {
    const store = transaction.objectStore('offlineOrders');
    const orders = await store.getAll();
    let resolvedOrders = 0;
    for (const order of orders) {
      if (!order.stockReview) continue;
      if (!unresolvedShortfalls(order).some((entry) => entry.productId === productId)) continue;
      const resolvedProductIds = [...new Set([...(order.stockReviewResolvedProductIds ?? []), productId])];
      const outstanding = (order.stockShortfalls ?? [])
        .some((entry) => !resolvedProductIds.includes(entry.productId));
      await store.put({
        ...order,
        stockReviewResolvedProductIds: resolvedProductIds,
        ...(outstanding ? {} : { stockReviewResolvedAt: resolvedAt }),
      });
      resolvedOrders += 1;
    }
    await transaction.done;
    return resolvedOrders;
  } catch (error) {
    try { transaction.abort(); } catch { /* The browser may already have aborted it. */ }
    throw error;
  } finally {
    database.close();
  }
}
