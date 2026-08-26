import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { CatalogProduct } from '../types/products';

export const BAANNOI_POS_DATABASE_NAME = 'BaannoiPOS';
export const BAANNOI_POS_SCHEMA_VERSION = 4;
export const PRODUCT_SNAPSHOT_KEY = 'confirmed';
export const CATALOG_METADATA_KEY = 'catalog';
export const OFFLINE_AUTHORIZATION_KEY = 'offlineAuthorization';
export const PROMPTPAY_CONFIG_KEY = 'promptpay';

export interface ProductSnapshotRecord {
  key: typeof PRODUCT_SNAPSHOT_KEY;
  products: CatalogProduct[];
}

export interface CatalogSnapshotMetadata {
  key: typeof CATALOG_METADATA_KEY;
  lastSuccessfulCatalogSyncAt: string;
  schemaVersion: number;
}

export interface OfflineAuthorizationRecord {
  key: typeof OFFLINE_AUTHORIZATION_KEY;
  enabledAt: string;
  expiresAt: string;
  schemaVersion: number;
}

export interface OfflinePaymentConfigRecord {
  key: typeof PROMPTPAY_CONFIG_KEY;
  version: number;
  merchantAccountInfo: string;
  provisionedAt: string;
}

export interface OfflineOrder {
  localOrderId: string;
  localOrderNumber: string;
  /**
   * The same checkout identity the online `POST /api/orders` would have sent as
   * `Idempotency-Key`. Carrying it here lets a later sync replay the sale without
   * duplicating an order the server may already have committed. Orders written
   * before schema v4 predate the field.
   */
  idempotencyKey?: string;
  createdAt: string;
  businessDate: string;
  paymentMethod: 'cash' | 'transfer';
  customerType: 'walkin' | 'member' | 'store';
  subtotal: number;
  discount: number;
  total: number;
  amountTendered?: number;
  changeAmount?: number;
  paymentConfirmation?: 'manual';
  status: 'completed';
  syncStatus: 'pending';
}

export interface OfflineOrderItem {
  localOrderItemId: string;
  localOrderId: string;
  productId: number;
  productName: string;
  productCode: string;
  unitPrice: number;
  qty: number;
  giveawayQty: number;
  paidLineSubtotal: number;
}

export interface OfflineStockMovement {
  localMovementId: string;
  localOrderId: string;
  referenceId: string;
  createdAt: string;
  businessDate: string;
  productId: number;
  semanticType: 'sale' | 'giveaway';
  quantity: number;
}

export interface BaannoiPosDatabase extends DBSchema {
  productSnapshot: {
    key: typeof PRODUCT_SNAPSHOT_KEY;
    value: ProductSnapshotRecord;
  };
  metadata: {
    key: string;
    value: CatalogSnapshotMetadata | OfflineAuthorizationRecord;
  };
  offlineOrders: {
    key: string;
    value: OfflineOrder;
    indexes: {
      'by-sync-status': string;
      'by-created-at': string;
      'by-idempotency-key': string;
    };
  };
  offlineOrderItems: {
    key: string;
    value: OfflineOrderItem;
    indexes: { 'by-local-order': string };
  };
  offlineStockMovements: {
    key: string;
    value: OfflineStockMovement;
    indexes: { 'by-local-order': string; 'by-product': number };
  };
  offlinePaymentConfig: {
    key: typeof PROMPTPAY_CONFIG_KEY;
    value: OfflinePaymentConfigRecord;
  };
}

export function openBaannoiPosDatabase(): Promise<IDBPDatabase<BaannoiPosDatabase>> {
  return openDB<BaannoiPosDatabase>(BAANNOI_POS_DATABASE_NAME, BAANNOI_POS_SCHEMA_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore('productSnapshot', { keyPath: 'key' });
        database.createObjectStore('metadata', { keyPath: 'key' });
      }
      if (oldVersion < 2) {
        const orders = database.createObjectStore('offlineOrders', { keyPath: 'localOrderId' });
        orders.createIndex('by-sync-status', 'syncStatus');
        orders.createIndex('by-created-at', 'createdAt');
        const items = database.createObjectStore('offlineOrderItems', { keyPath: 'localOrderItemId' });
        items.createIndex('by-local-order', 'localOrderId');
        const movements = database.createObjectStore('offlineStockMovements', { keyPath: 'localMovementId' });
        movements.createIndex('by-local-order', 'localOrderId');
        movements.createIndex('by-product', 'productId');
      }
      if (oldVersion < 3) {
        database.createObjectStore('offlinePaymentConfig', { keyPath: 'key' });
      }
      if (oldVersion < 4) {
        // Legacy orders have no idempotencyKey, so they simply stay out of the
        // index rather than colliding on it.
        transaction.objectStore('offlineOrders')
          .createIndex('by-idempotency-key', 'idempotencyKey', { unique: true });
      }
    },
  });
}
