import { openDB, type DBSchema } from 'idb';

import type { CatalogProduct } from '../types/products';

export const BAANNOI_POS_DATABASE_NAME = 'BaannoiPOS';
export const BAANNOI_POS_SCHEMA_VERSION = 1;

const PRODUCT_SNAPSHOT_KEY = 'confirmed';
const CATALOG_METADATA_KEY = 'catalog';

interface ProductSnapshotRecord {
  key: typeof PRODUCT_SNAPSHOT_KEY;
  products: CatalogProduct[];
}

export interface CatalogSnapshotMetadata {
  key: typeof CATALOG_METADATA_KEY;
  lastSuccessfulCatalogSyncAt: string;
  schemaVersion: number;
}

export interface ConfirmedCatalogSnapshot {
  products: CatalogProduct[];
  metadata: CatalogSnapshotMetadata;
}

interface BaannoiPosDatabase extends DBSchema {
  productSnapshot: {
    key: typeof PRODUCT_SNAPSHOT_KEY;
    value: ProductSnapshotRecord;
  };
  metadata: {
    key: typeof CATALOG_METADATA_KEY;
    value: CatalogSnapshotMetadata;
  };
}

function openBaannoiPosDatabase() {
  return openDB<BaannoiPosDatabase>(BAANNOI_POS_DATABASE_NAME, BAANNOI_POS_SCHEMA_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('productSnapshot', { keyPath: 'key' });
        database.createObjectStore('metadata', { keyPath: 'key' });
      }
    },
  });
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

export async function readConfirmedCatalogSnapshot(): Promise<ConfirmedCatalogSnapshot | null> {
  const database = await openBaannoiPosDatabase();
  try {
    const transaction = database.transaction(['productSnapshot', 'metadata'], 'readonly');
    const [snapshot, metadata] = await Promise.all([
      transaction.objectStore('productSnapshot').get(PRODUCT_SNAPSHOT_KEY),
      transaction.objectStore('metadata').get(CATALOG_METADATA_KEY),
      transaction.done,
    ]);
    if (!snapshot || !metadata) return null;
    return { products: snapshot.products, metadata };
  } finally {
    database.close();
  }
}
