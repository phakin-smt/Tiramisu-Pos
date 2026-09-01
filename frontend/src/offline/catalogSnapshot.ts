import type { CatalogProduct } from '../types/products';
import {
  BAANNOI_POS_DATABASE_NAME,
  BAANNOI_POS_SCHEMA_VERSION,
  CATALOG_METADATA_KEY,
  openBaannoiPosDatabase,
  PRODUCT_SNAPSHOT_KEY,
  type CatalogSnapshotMetadata,
} from './database';

export { BAANNOI_POS_DATABASE_NAME, BAANNOI_POS_SCHEMA_VERSION } from './database';
export type { CatalogSnapshotMetadata } from './database';

export interface ConfirmedCatalogSnapshot {
  products: CatalogProduct[];
  metadata: CatalogSnapshotMetadata;
}

export async function replaceConfirmedCatalogSnapshot(
  products: readonly CatalogProduct[],
  syncedAt = new Date().toISOString(),
): Promise<CatalogSnapshotMetadata> {
  const database = await openBaannoiPosDatabase();
  const metadata: CatalogSnapshotMetadata = {
    key: CATALOG_METADATA_KEY,
    lastSuccessfulCatalogSyncAt: syncedAt,
    schemaVersion: BAANNOI_POS_SCHEMA_VERSION,
  };

  try {
    const transaction = database.transaction(['productSnapshot', 'metadata'], 'readwrite');
    await Promise.all([
      transaction.objectStore('productSnapshot').put({
        key: PRODUCT_SNAPSHOT_KEY,
        products: [...products],
      }),
      transaction.objectStore('metadata').put(metadata),
      transaction.done,
    ]);
    return metadata;
  } finally {
    database.close();
  }
}

export async function replaceConfirmedCatalogSnapshotIfNoPendingOrders(
  products: readonly CatalogProduct[],
  syncedAt = new Date().toISOString(),
): Promise<CatalogSnapshotMetadata | null> {
  const database = await openBaannoiPosDatabase();
  const metadata: CatalogSnapshotMetadata = {
    key: CATALOG_METADATA_KEY,
    lastSuccessfulCatalogSyncAt: syncedAt,
    schemaVersion: BAANNOI_POS_SCHEMA_VERSION,
  };
  const transaction = database.transaction(
    ['offlineOrders', 'productSnapshot', 'metadata'],
    'readwrite',
  );

  try {
    // Anything the server has not accepted still owns the local stock numbers,
    // whether it is waiting to sync or was rejected outright.
    const syncStatus = transaction.objectStore('offlineOrders').index('by-sync-status');
    const [pending, failed] = await Promise.all([
      syncStatus.count('pending'),
      syncStatus.count('failed'),
    ]);
    const pendingCount = pending + failed;
    if (pendingCount > 0) {
      await transaction.done;
      return null;
    }
    await transaction.objectStore('productSnapshot').put({
      key: PRODUCT_SNAPSHOT_KEY,
      products: [...products],
    });
    await transaction.objectStore('metadata').put(metadata);
    await transaction.done;
    return metadata;
  } catch (error) {
    try { transaction.abort(); } catch { /* The browser may already have aborted it. */ }
    throw error;
  } finally {
    database.close();
  }
}

export async function readConfirmedCatalogSnapshot(): Promise<ConfirmedCatalogSnapshot | null> {
  const database = await openBaannoiPosDatabase();
  try {
    const transaction = database.transaction(['productSnapshot', 'metadata'], 'readonly');
    const [snapshot, metadata] = await Promise.all([
      transaction.objectStore('productSnapshot').get(PRODUCT_SNAPSHOT_KEY),
      transaction.objectStore('metadata').get(CATALOG_METADATA_KEY),
      transaction.done,
    ]);
    if (!snapshot || !metadata || metadata.key !== CATALOG_METADATA_KEY) return null;
    return { products: snapshot.products, metadata };
  } finally {
    database.close();
  }
}
