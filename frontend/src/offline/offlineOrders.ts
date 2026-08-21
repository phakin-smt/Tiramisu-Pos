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
} from './database';
import { OFFLINE_AUTHORIZATION_REQUIRED_MESSAGE } from './offlineAuthorization';

export const INSUFFICIENT_OFFLINE_STOCK_MESSAGE = 'สต็อกไม่เพียงพอ กรุณาตรวจสอบรายการอีกครั้ง';
export const OFFLINE_PROMPTPAY_MESSAGE = 'PromptPay แบบออฟไลน์จะเปิดใช้งานในขั้นตอนถัดไป';
export const PENDING_OFFLINE_ORDERS_MESSAGE = 'มีรายการออฟไลน์ที่ยังไม่ได้ Sync กรุณา Sync ก่อนอัปเดตสต็อกจากระบบ';
export const LOCAL_MODE_MESSAGE = 'มีออเดอร์ออฟไลน์ที่ยังไม่ได้ Sync การขายจะยังบันทึกในเครื่อง';
export const LOCAL_MODE_PROMPTPAY_MESSAGE = 'PromptPay ใช้งานไม่ได้ขณะมีออเดอร์รอ Sync';

export interface OfflineCashDetails {
  totals: CartTotals;
  amountTendered: number;
  changeAmount: number;
}

export interface OfflineOrderIdentity {
  localOrderId: string;
  localOrderNumber: string;
  createdAt: string;
  businessDate: string;
}

export interface OfflineCashSaleInput extends OfflineCashDetails {
  identity: OfflineOrderIdentity;
  order: CreateOrderRequest;
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

export async function recordOfflineCashSale(input: OfflineCashSaleInput): Promise<OfflineOrder> {
  if (input.order.paymentMethod !== 'cash') throw new Error(OFFLINE_PROMPTPAY_MESSAGE);
  const database = await openBaannoiPosDatabase();
  const transaction = database.transaction(
    ['metadata', 'productSnapshot', 'offlineOrders', 'offlineOrderItems', 'offlineStockMovements'],
    'readwrite',
  );

  try {
    const existing = await transaction.objectStore('offlineOrders').get(input.identity.localOrderId);
    if (existing) {
      await transaction.done;
      return existing;
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
      paymentMethod: 'cash',
      customerType: input.order.customerType,
      subtotal: input.totals.subtotal,
      discount: input.totals.discount,
      total: input.totals.grandTotal,
      amountTendered: input.amountTendered,
      changeAmount: input.changeAmount,
      status: 'completed',
      syncStatus: 'pending',
    };
    await transaction.objectStore('offlineOrders').add(order);
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

export async function getPendingOfflineOrderCount(): Promise<number> {
  const database = await openBaannoiPosDatabase();
  try {
    return await database.countFromIndex('offlineOrders', 'by-sync-status', 'pending');
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
