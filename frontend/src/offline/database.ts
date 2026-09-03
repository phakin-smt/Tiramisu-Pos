import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { CatalogProduct } from '../types/products';

export const BAANNOI_POS_DATABASE_NAME = 'BaannoiPOS';
export const BAANNOI_POS_SCHEMA_VERSION = 4;
export const PRODUCT_SNAPSHOT_KEY = 'confirmed';
export const CATALOG_METADATA_KEY = 'catalog';
export const OFFLINE_AUTHORIZATION_KEY = 'offlineAuthorization';
export const PROMPTPAY_CONFIG_KEY = 'promptpay';
export const PRICING_RULES_KEY = 'pricingRules';

export interface ProductSnapshotRecord {
  key: typeof PRODUCT_SNAPSHOT_KEY;
  /**
   * Which shop's menu and stock this is. A snapshot taken for one store must
   * never be shown for another; a record written before stores existed has no
   * id and belongs to the first store, the only one there was.
   */
  storeId?: number;
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

/**
 * The selling store's automatic discounts, kept so an offline till prices a cart
 * the same way the server would. Lives in the existing metadata store, which
 * needs no schema version bump to hold another key.
 */
export interface PricingRulesRecord {
  key: typeof PRICING_RULES_KEY;
  storeId: number;
  storeName: string;
  storeLogoUrl?: string | null;
  bundle: { unitPrice: number; quantity: number; price: number } | null;
  wholesale: { category: string; discountPerItem: number } | null;
  savedAt: string;
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
   * The shop this sale was rung up for, recorded when it was taken rather than
   * inferred at sync time. Without it a queue drained under the wrong selection
   * would file one shop's takings under another. Orders written before stores
   * existed have no id and belong to the first store.
   */
  storeId?: number;
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
  /**
   * `failed` is a sale the server refused for a reason retrying cannot fix. It
   * still counts as unsynced revenue, so it keeps Local Mode latched until a
   * human deals with it.
   */
  syncStatus: 'pending' | 'synced' | 'failed';
  syncedAt?: string;
  syncError?: string;
  /** Server order number assigned when the sale was accepted. */
  serverOrderNumber?: string;
  /** The server floored stock at zero for this sale; someone must reconcile it. */
  stockReview?: boolean;
  /** What the server could not deduct, per product, exactly as it reported it. */
  stockShortfalls?: OfflineStockShortfall[];
  /**
   * Products whose review a physical count has already settled. Resolution is
   * additive so the shortfall history above is never rewritten or erased.
   */
  stockReviewResolvedProductIds?: number[];
  stockReviewResolvedAt?: string;
}

export interface OfflineStockShortfall {
  productId: number;
  productName: string;
  shortfall: number;
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
    value: CatalogSnapshotMetadata | OfflineAuthorizationRecord | PricingRulesRecord;
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
    /**
     * Yield the moment another context needs to upgrade or delete the database.
     * Without this an idle connection — a second tab, or the Safari tab beside
     * the installed app — blocks that request forever, and every offline read
     * hangs with no error to show.
     */
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase | null)?.close();
    },
  });
}
