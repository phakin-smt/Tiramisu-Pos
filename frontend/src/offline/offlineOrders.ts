import type { CreateOrderRequest } from '../types/checkout';
import type { CartTotals } from '../types/domain';
import {
  CATALOG_METADATA_KEY,
  OFFLINE_AUTHORIZATION_KEY,
  PRODUCT_SNAPSHOT_KEY,
  openBaannoiPosDatabase,
  type CatalogSnapshotMetadata,
  type OfflineAuthorizationRecord,
  type OfflineOrder,
  type OfflineOrderItem,
  type OfflineStockMovement,
  type OfflineStockShortfall,
} from './database';
import { OFFLINE_AUTHORIZATION_REQUIRED_MESSAGE } from './offlineAuthorization';

export const INSUFFICIENT_OFFLINE_STOCK_MESSAGE = 'สต็อกไม่เพียงพอ กรุณาตรวจสอบรายการอีกครั้ง';
export const PENDING_OFFLINE_ORDERS_MESSAGE = 'มีรายการออฟไลน์ที่ยังไม่ได้ Sync กรุณา Sync ก่อนอัปเดตสต็อกจากระบบ';
export const LOCAL_MODE_MESSAGE = 'มีออเดอร์ออฟไลน์ที่ยังไม่ได้ Sync การขายจะยังบันทึกในเครื่อง';

export interface OfflineSaleDetails {
  totals: CartTotals;
  amountTendered?: number;
  changeAmount?: number;
}

export interface OfflineCashDetails extends OfflineSaleDetails {
  amountTendered: number;
  changeAmount: number;
}

export interface OfflineOrderIdentity {
  localOrderId: string;
  localOrderNumber: string;
  createdAt: string;
  businessDate: string;
}

export interface OfflineSaleInput extends OfflineSaleDetails {
  identity: OfflineOrderIdentity;
  order: CreateOrderRequest;
  /**
   * The checkout idempotency key. Pass the same key an online attempt used so a
   * lost `POST /api/orders` response cannot become a second sale at sync time.
   */
  idempotencyKey?: string;
}

export interface OfflineCashSaleInput extends OfflineCashDetails {
  identity: OfflineOrderIdentity;
  order: CreateOrderRequest;
  idempotencyKey?: string;
}

export function createClientUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('อุปกรณ์นี้ไม่รองรับการสร้างรหัสออเดอร์ออฟไลน์อย่างปลอดภัย');
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bangkokParts(now: Date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return values as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>;
}

export function createOfflineOrderIdentity(now = new Date()): OfflineOrderIdentity {
  const localOrderId = createClientUuid();
  const part = bangkokParts(now);
  const suffix = localOrderId.replaceAll('-', '').slice(-4).toUpperCase();
  return {
    localOrderId,
    localOrderNumber: `OFF-${part.year}${part.month}${part.day}-${part.hour}${part.minute}${part.second}-${suffix}`,
    createdAt: now.toISOString(),
    businessDate: `${part.year}-${part.month}-${part.day}`,
  };
}

function authorizationValid(value: CatalogSnapshotMetadata | OfflineAuthorizationRecord | undefined, at: string) {
  return value?.key === OFFLINE_AUTHORIZATION_KEY && Date.parse(value.expiresAt) > Date.parse(at);
}

export async function recordOfflineSale(input: OfflineSaleInput): Promise<OfflineOrder> {
  if (input.order.paymentMethod === 'cash'
    && (input.amountTendered === undefined || input.changeAmount === undefined)) {
    throw new Error('ข้อมูลการรับเงินสดไม่ครบถ้วน');
  }
  const database = await openBaannoiPosDatabase();
  const transaction = database.transaction(
    ['metadata', 'productSnapshot', 'offlineOrders', 'offlineOrderItems', 'offlineStockMovements'],
    'readwrite',
  );

  try {
    const orders = transaction.objectStore('offlineOrders');
    const existing = await orders.get(input.identity.localOrderId);
    if (existing) {
      await transaction.done;
      return existing;
    }
    // A retry that changed its mind about the local order id must still not
    // produce a second sale for the same checkout.
    if (input.idempotencyKey) {
      const replayed = await orders.index('by-idempotency-key').get(input.idempotencyKey);
      if (replayed) {
        await transaction.done;
        return replayed;
      }
    }

    const authorization = await transaction.objectStore('metadata').get(OFFLINE_AUTHORIZATION_KEY);
    if (!authorizationValid(authorization, new Date().toISOString())) {
      throw new Error(OFFLINE_AUTHORIZATION_REQUIRED_MESSAGE);
    }
    const snapshot = await transaction.objectStore('productSnapshot').get(PRODUCT_SNAPSHOT_KEY);
    if (!snapshot) throw new Error('ไม่พบข้อมูลสินค้าออฟไลน์ กรุณาเชื่อมต่ออินเทอร์เน็ตอีกครั้ง');

    const seen = new Set<number>();
    const items: OfflineOrderItem[] = [];
    const movements: OfflineStockMovement[] = [];
    const updatedProducts = [...snapshot.products];

    for (const cartItem of input.order.items) {
      if (seen.has(cartItem.productId)) throw new Error('สินค้าในตะกร้าไม่ถูกต้อง');
      seen.add(cartItem.productId);
      const index = updatedProducts.findIndex((product) => product.id === cartItem.productId);
      const product = updatedProducts[index];
      const paidQty = cartItem.qty - cartItem.giveawayQty;
      if (!product || cartItem.qty <= 0 || cartItem.giveawayQty < 0 || paidQty < 0 || product.stock < cartItem.qty) {
        throw new Error(INSUFFICIENT_OFFLINE_STOCK_MESSAGE);
      }
      updatedProducts[index] = { ...product, stock: product.stock - cartItem.qty };
      items.push({
        localOrderItemId: `${input.identity.localOrderId}:${product.id}`,
        localOrderId: input.identity.localOrderId,
        productId: product.id,
        productName: product.name,
        productCode: product.code,
        unitPrice: product.price,
        qty: paidQty,
        giveawayQty: cartItem.giveawayQty,
        paidLineSubtotal: product.price * paidQty,
      });
      if (paidQty > 0) movements.push({
        localMovementId: `${input.identity.localOrderId}:${product.id}:sale`,
        localOrderId: input.identity.localOrderId,
        referenceId: input.identity.localOrderId,
        createdAt: input.identity.createdAt,
        businessDate: input.identity.businessDate,
        productId: product.id,
        semanticType: 'sale',
        quantity: -paidQty,
      });
      if (cartItem.giveawayQty > 0) movements.push({
        localMovementId: `${input.identity.localOrderId}:${product.id}:giveaway`,
        localOrderId: input.identity.localOrderId,
        referenceId: input.identity.localOrderId,
        createdAt: input.identity.createdAt,
        businessDate: input.identity.businessDate,
        productId: product.id,
        semanticType: 'giveaway',
        quantity: -cartItem.giveawayQty,
      });
    }

    const order: OfflineOrder = {
      ...input.identity,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      paymentMethod: input.order.paymentMethod,
      customerType: input.order.customerType,
      subtotal: input.totals.subtotal,
      discount: input.totals.discount,
      total: input.totals.grandTotal,
      status: 'completed',
      syncStatus: 'pending',
      ...(input.order.paymentMethod === 'cash'
        ? { amountTendered: input.amountTendered, changeAmount: input.changeAmount }
        : { paymentConfirmation: 'manual' as const }),
    };
    await orders.add(order);
    for (const item of items) await transaction.objectStore('offlineOrderItems').add(item);
    for (const movement of movements) await transaction.objectStore('offlineStockMovements').add(movement);
    await transaction.objectStore('productSnapshot').put({ key: PRODUCT_SNAPSHOT_KEY, products: updatedProducts });
    await transaction.done;
    return order;
  } catch (error) {
    try { transaction.abort(); } catch { /* The browser may already have aborted the transaction. */ }
    try { await transaction.done; } catch { /* Preserve the original validation/write error. */ }
    throw error;
  } finally {
    database.close();
  }
}

export function recordOfflineCashSale(input: OfflineCashSaleInput): Promise<OfflineOrder> {
  if (input.order.paymentMethod !== 'cash') return Promise.reject(new Error('วิธีชำระเงินไม่ถูกต้อง'));
  return recordOfflineSale(input);
}

export async function getPendingOfflineOrderCount(): Promise<number> {
  const database = await openBaannoiPosDatabase();
  try {
    return await database.countFromIndex('offlineOrders', 'by-sync-status', 'pending');
  } finally {
    database.close();
  }
}

/**
 * Everything the server has not accepted yet, retryable or not. This is what
 * keeps Local Mode latched and the catalog snapshot protected — a sale the
 * server rejected is still money that has not been recorded upstream.
 */
export async function getUnsyncedOfflineOrderCount(): Promise<number> {
  const database = await openBaannoiPosDatabase();
  try {
    const transaction = database.transaction('offlineOrders', 'readonly');
    const index = transaction.objectStore('offlineOrders').index('by-sync-status');
    const [pending, failed] = await Promise.all([
      index.count('pending'),
      index.count('failed'),
      transaction.done,
    ]);
    return pending + failed;
  } finally {
    database.close();
  }
}

export async function getOfflineOrdersToSync(): Promise<OfflineOrder[]> {
  const database = await openBaannoiPosDatabase();
  try {
    const orders = await database.getAllFromIndex('offlineOrders', 'by-sync-status', 'pending');
    // Oldest first, so the server sees the day in the order it was sold.
    return orders.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } finally {
    database.close();
  }
}

/**
 * Gives a pre-v4 order a replay key and persists it before it is ever sent.
 *
 * Such an order was only ever written on this device, so the server has never
 * seen it and a fresh key is safe. Persisting first is what makes it safe: a
 * drain interrupted after the POST still finds the same key next time.
 */
export async function ensureOfflineOrderIdempotencyKey(localOrderId: string): Promise<string | null> {
  const database = await openBaannoiPosDatabase();
  const transaction = database.transaction('offlineOrders', 'readwrite');
  try {
    const store = transaction.objectStore('offlineOrders');
    const order = await store.get(localOrderId);
    if (!order) {
      await transaction.done;
      return null;
    }
    if (order.idempotencyKey) {
      await transaction.done;
      return order.idempotencyKey;
    }
    const idempotencyKey = createClientUuid();
    await store.put({ ...order, idempotencyKey });
    await transaction.done;
    return idempotencyKey;
  } catch (error) {
    try { transaction.abort(); } catch { /* The browser may already have aborted it. */ }
    throw error;
  } finally {
    database.close();
  }
}

export interface OfflineOrderSyncResult {
  syncStatus: 'synced' | 'failed';
  serverOrderNumber?: string;
  syncError?: string;
  stockReview?: boolean;
  stockShortfalls?: OfflineStockShortfall[];
}

/**
 * Records the outcome of one replay in its own transaction, so a failure part
 * way through a drain never rolls back the orders already accepted.
 */
export async function markOfflineOrderSynced(
  localOrderId: string,
  result: OfflineOrderSyncResult,
  syncedAt = new Date().toISOString(),
): Promise<OfflineOrder | null> {
  const database = await openBaannoiPosDatabase();
  const transaction = database.transaction('offlineOrders', 'readwrite');
  try {
    const store = transaction.objectStore('offlineOrders');
    const order = await store.get(localOrderId);
    if (!order) {
      await transaction.done;
      return null;
    }
    const updated: OfflineOrder = {
      ...order,
      syncStatus: result.syncStatus,
      ...(result.syncStatus === 'synced' ? { syncedAt } : {}),
      ...(result.serverOrderNumber ? { serverOrderNumber: result.serverOrderNumber } : {}),
      ...(result.syncError ? { syncError: result.syncError } : {}),
      ...(result.stockReview ? { stockReview: true } : {}),
      ...(result.stockShortfalls?.length ? { stockShortfalls: result.stockShortfalls } : {}),
    };
    await store.put(updated);
    await transaction.done;
    return updated;
  } catch (error) {
    try { transaction.abort(); } catch { /* The browser may already have aborted it. */ }
    throw error;
  } finally {
    database.close();
  }
}

/** Everything the server has not accepted yet, oldest first, for the queue UI. */
export async function getUnsyncedOfflineOrders(): Promise<OfflineOrder[]> {
  const database = await openBaannoiPosDatabase();
  try {
    const orders = await database.getAllFromIndex('offlineOrders', 'by-created-at');
    return orders.filter((order) => order.syncStatus !== 'synced');
  } finally {
    database.close();
  }
}

/**
 * Puts a failed order back in the queue without touching anything that defines
 * it. The identity, idempotency key, timestamps, payment method and totals are
 * all preserved, so a retry replays the very same sale rather than creating a
 * new one — only the failure marker is cleared.
 */
export async function retryFailedOfflineOrder(localOrderId: string): Promise<OfflineOrder | null> {
  const database = await openBaannoiPosDatabase();
  const transaction = database.transaction('offlineOrders', 'readwrite');
  try {
    const store = transaction.objectStore('offlineOrders');
    const order = await store.get(localOrderId);
    if (!order || order.syncStatus !== 'failed') {
      await transaction.done;
      return order ?? null;
    }
    const { syncError: _discarded, ...rest } = order;
    const requeued: OfflineOrder = { ...rest, syncStatus: 'pending' };
    await store.put(requeued);
    await transaction.done;
    return requeued;
  } catch (error) {
    try { transaction.abort(); } catch { /* The browser may already have aborted it. */ }
    throw error;
  } finally {
    database.close();
  }
}

export async function getOfflineOrderByIdempotencyKey(
  idempotencyKey: string,
): Promise<OfflineOrder | null> {
  const database = await openBaannoiPosDatabase();
  try {
    return await database.getFromIndex('offlineOrders', 'by-idempotency-key', idempotencyKey) ?? null;
  } finally {
    database.close();
  }
}

export async function getRecentOfflineOrders(limit = 10): Promise<OfflineOrder[]> {
  const database = await openBaannoiPosDatabase();
  try {
    const orders = await database.getAllFromIndex('offlineOrders', 'by-created-at');
    return orders.reverse().slice(0, Math.max(0, limit));
  } finally {
    database.close();
  }
}

export async function getOfflineOrderDetails(localOrderId: string) {
  const database = await openBaannoiPosDatabase();
  try {
    const transaction = database.transaction(['offlineOrders', 'offlineOrderItems', 'offlineStockMovements']);
    const [order, items, movements] = await Promise.all([
      transaction.objectStore('offlineOrders').get(localOrderId),
      transaction.objectStore('offlineOrderItems').index('by-local-order').getAll(localOrderId),
      transaction.objectStore('offlineStockMovements').index('by-local-order').getAll(localOrderId),
      transaction.done,
    ]);
    return order ? { order, items, movements } : null;
  } finally {
    database.close();
  }
}
