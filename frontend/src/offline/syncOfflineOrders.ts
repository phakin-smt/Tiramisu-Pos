import { createOrder } from '../api/checkout';
import { ApiError, isNetworkFailure } from '../api/client';
import type { CreateOrderRequest } from '../types/checkout';
import type { OfflineOrder, OfflineOrderItem } from './database';
import {
  ensureOfflineOrderIdempotencyKey,
  getOfflineOrderDetails,
  getOfflineOrdersToSync,
  getUnsyncedOfflineOrderCount,
  markOfflineOrderSynced,
} from './offlineOrders';

export const OFFLINE_SYNC_INCOMPLETE_MESSAGE = 'ยังไม่สามารถ Sync ออเดอร์ออฟไลน์ได้ทั้งหมด';
export const OFFLINE_SYNC_MISSING_ITEMS_MESSAGE = 'ไม่พบรายการสินค้าของออเดอร์นี้';

export interface OfflineSyncOutcome {
  synced: number;
  failed: number;
  /** Orders still unaccepted by the server: pending plus failed. */
  remaining: number;
  stockReviews: number;
  stopped: 'complete' | 'offline';
  error: string;
}

/**
 * Rebuilds the payload the online checkout would have sent.
 *
 * Offline items store `qty` already net of giveaways, while the API expects the
 * gross quantity and derives the paid amount itself. Sending the stored `qty`
 * unchanged would under-deduct stock and under-report the sale.
 */
function buildReplayPayload(
  order: OfflineOrder,
  items: readonly OfflineOrderItem[],
): CreateOrderRequest {
  return {
    items: items.map((item) => ({
      productId: item.productId,
      qty: item.qty + item.giveawayQty,
      giveawayQty: item.giveawayQty,
    })),
    paymentMethod: order.paymentMethod,
    customerType: order.customerType,
    discount: order.discount,
    offline: {
      businessDate: order.businessDate,
      createdAt: order.createdAt,
      localOrderNumber: order.localOrderNumber,
    },
  };
}

/**
 * Replays this store's pending offline sales, oldest first.
 *
 * Sales belonging to another shop are left alone rather than posted under the
 * current selection -- they wait until that shop is selected again.
 *
 * A transport failure stops the drain and leaves the rest pending — the network
 * is gone, so continuing would only pile up retries. A rejection the server will
 * never accept marks that one order `failed` and the drain continues, so a
 * single poison order cannot strand the whole day behind it. Nothing is ever
 * deleted, and each outcome is written in its own transaction.
 */
export async function syncPendingOfflineOrders(storeId: number): Promise<OfflineSyncOutcome> {
  const queue = await getOfflineOrdersToSync(storeId);
  let synced = 0;
  let failed = 0;
  let stockReviews = 0;
  let stopped: OfflineSyncOutcome['stopped'] = 'complete';
  let error = '';

  for (const order of queue) {
    const details = await getOfflineOrderDetails(order.localOrderId);
    if (!details?.items.length) {
      // Nothing to replay: flag it rather than silently dropping the record.
      await markOfflineOrderSynced(order.localOrderId, {
        syncStatus: 'failed',
        syncError: OFFLINE_SYNC_MISSING_ITEMS_MESSAGE,
      });
      failed += 1;
      continue;
    }
    // Pre-v4 orders have no key; mint and persist one before sending.
    const idempotencyKey = order.idempotencyKey ?? await ensureOfflineOrderIdempotencyKey(order.localOrderId);
    if (!idempotencyKey) continue;

    try {
      const response = await createOrder(
        buildReplayPayload(order, details.items),
        idempotencyKey,
      );
      await markOfflineOrderSynced(order.localOrderId, {
        syncStatus: 'synced',
        serverOrderNumber: response.orderNumber,
        stockReview: response.stockReview,
        stockShortfalls: response.stockShortfalls,
      });
      synced += 1;
      if (response.stockReview) stockReviews += 1;
    } catch (caught) {
      if (isNetworkFailure(caught)) {
        stopped = 'offline';
        error = caught instanceof Error ? caught.message : OFFLINE_SYNC_INCOMPLETE_MESSAGE;
        break;
      }
      // 4xx/5xx: the server answered and refused. Retrying identical bytes will
      // not change that, so record why and keep draining the rest.
      await markOfflineOrderSynced(order.localOrderId, {
        syncStatus: 'failed',
        syncError: caught instanceof ApiError ? caught.message : OFFLINE_SYNC_INCOMPLETE_MESSAGE,
      });
      failed += 1;
    }
  }

  const remaining = await getUnsyncedOfflineOrderCount(storeId);
  if (!error && remaining > 0) error = OFFLINE_SYNC_INCOMPLETE_MESSAGE;
  return { synced, failed, remaining, stockReviews, stopped, error };
}
