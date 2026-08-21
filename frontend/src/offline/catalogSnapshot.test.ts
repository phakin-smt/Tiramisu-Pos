import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CatalogProduct } from '../types/products';
import {
  BAANNOI_POS_DATABASE_NAME,
  BAANNOI_POS_SCHEMA_VERSION,
  readConfirmedCatalogSnapshot,
  replaceConfirmedCatalogSnapshot,
} from './catalogSnapshot';

const original: CatalogProduct = {
  id: 17,
  code: 'ORI-17',
  barcode: '8850000017',
  name: 'Original',
  category: 'Tiramisu',
  price: 69,
  cost: 25.5,
  stock: 8,
  minStock: 2,
  active: false,
  icon: '🍰',
};

describe('catalog snapshot IndexedDB storage', () => {
  beforeEach(async () => deleteDB(BAANNOI_POS_DATABASE_NAME));
  afterEach(async () => deleteDB(BAANNOI_POS_DATABASE_NAME));

  it('round-trips every catalog product field and writes versioned ISO metadata', async () => {
    const syncedAt = '2026-08-21T04:30:00.000Z';
    await replaceConfirmedCatalogSnapshot([original], syncedAt);

    const snapshot = await readConfirmedCatalogSnapshot();
    expect(snapshot?.products).toEqual([original]);
    expect(snapshot?.metadata).toEqual({
      key: 'catalog',
      lastSuccessfulCatalogSyncAt: syncedAt,
      schemaVersion: BAANNOI_POS_SCHEMA_VERSION,
    });
    expect(new Date(snapshot!.metadata.lastSuccessfulCatalogSyncAt).toISOString()).toBe(syncedAt);
  });

  it('atomically replaces the complete prior snapshot after a second success', async () => {
    await replaceConfirmedCatalogSnapshot([original], '2026-08-21T04:30:00.000Z');
    const replacement = { ...original, id: 22, code: 'NEW-22', name: 'New', stock: 3 };

    await replaceConfirmedCatalogSnapshot([replacement], '2026-08-21T05:45:00.000Z');

    const snapshot = await readConfirmedCatalogSnapshot();
    expect(snapshot?.products).toEqual([replacement]);
    expect(snapshot?.products).not.toContainEqual(original);
    expect(snapshot?.metadata.lastSuccessfulCatalogSyncAt).toBe('2026-08-21T05:45:00.000Z');
  });

  it('accepts a confirmed empty server catalog as a complete replacement', async () => {
    await replaceConfirmedCatalogSnapshot([original], '2026-08-21T04:30:00.000Z');
    await replaceConfirmedCatalogSnapshot([], '2026-08-21T06:00:00.000Z');

    expect((await readConfirmedCatalogSnapshot())?.products).toEqual([]);
  });
});
