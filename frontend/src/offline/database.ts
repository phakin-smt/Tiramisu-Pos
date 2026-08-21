import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { CatalogProduct } from '../types/products';

export const BAANNOI_POS_DATABASE_NAME = 'BaannoiPOS';
export const BAANNOI_POS_SCHEMA_VERSION = 2;
export const PRODUCT_SNAPSHOT_KEY = 'confirmed';
export const CATALOG_METADATA_KEY = 'catalog';
export const OFFLINE_AUTHORIZATION_KEY = 'offlineAuthorization';

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

export interface OfflineOrder {
  localOrderId: string;
  localOrderNumber: string;
  createdAt: string;
  businessDate: string;
  paymentMethod: 'cash';
  customerType: 'walkin' | 'member' | 'store';
  subtotal: number;
  discount: number;
  total: number;
  amountTendered: number;
  changeAmount: number;
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
    indexes: { 'by-sync-status': string; 'by-created-at': string };
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
}

export function openBaannoiPosDatabase(): Promise<IDBPDatabase<BaannoiPosDatabase>> {
  return openDB<BaannoiPosDatabase>(BAANNOI_POS_DATABASE_NAME, BAANNOI_POS_SCHEMA_VERSION, {
    upgrade(database, oldVersion) {
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
    },
  });
}
