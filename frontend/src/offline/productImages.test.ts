import 'fake-indexeddb/auto';

import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogProduct } from '../types/products';
import {
  PROMTTAK_POS_DATABASE_NAME,
  PROMTTAK_POS_SCHEMA_VERSION,
  openPromttakPosDatabase,
} from './database';
import {
  cacheProductImages,
  imageVersionFromUrl,
  readProductImageObjectUrls,
  readProductImages,
} from './productImages';

function menu(id: number, imageUrl: string | null): CatalogProduct {
  return {
    id, code: `M${id}`, barcode: null, name: `Menu ${id}`, category: 'Tiramisu',
    price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰', imageUrl,
  };
}

const originalFetch = globalThis.fetch;

/** A stand-in server that hands back one byte per picture. */
function serving(bytesByUrl: Record<string, string>, failures: string[] = []) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failures.includes(url)) return new Response(null, { status: 404 });
    const body = bytesByUrl[url];
    if (body === undefined) throw new TypeError('Failed to fetch');
    return new Response(new TextEncoder().encode(body), {
      status: 200,
      headers: { 'Content-Type': 'image/webp' },
    });
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('imageVersionFromUrl', () => {
  it('reads the checksum the server put in the address', () => {
    expect(imageVersionFromUrl('/api/products/7/image?v=abc123')).toBe('abc123');
  });

  it('is empty for an address that carries none', () => {
    expect(imageVersionFromUrl('/api/products/7/image')).toBe('');
    expect(imageVersionFromUrl('')).toBe('');
  });
});

describe('cacheProductImages', () => {
  it('downloads a picture once and keeps it', async () => {
    globalThis.fetch = serving({ '/api/products/1/image?v=aaa': 'first' }) as typeof fetch;
    const products = [menu(1, '/api/products/1/image?v=aaa')];

    expect(await cacheProductImages(products, 1)).toEqual({ saved: 1, removed: 0, failed: 0 });
    const [stored] = await readProductImages(1);
    expect(stored.version).toBe('aaa');
    expect(new TextDecoder().decode(stored.bytes)).toBe('first');
    expect(stored.contentType).toBe('image/webp');
  });

  it('leaves an unchanged picture alone rather than fetching it again', async () => {
    const fetcher = serving({ '/api/products/1/image?v=aaa': 'first' });
    globalThis.fetch = fetcher as typeof fetch;
    const products = [menu(1, '/api/products/1/image?v=aaa')];

    await cacheProductImages(products, 1);
    expect(await cacheProductImages(products, 1)).toEqual({ saved: 0, removed: 0, failed: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('replaces a picture whose checksum has moved on', async () => {
    globalThis.fetch = serving({
      '/api/products/1/image?v=aaa': 'first',
      '/api/products/1/image?v=bbb': 'second',
    }) as typeof fetch;

    await cacheProductImages([menu(1, '/api/products/1/image?v=aaa')], 1);
    const result = await cacheProductImages([menu(1, '/api/products/1/image?v=bbb')], 1);

    expect(result.saved).toBe(1);
    const held = await readProductImages(1);
    expect(held).toHaveLength(1);
    expect(new TextDecoder().decode(held[0].bytes)).toBe('second');
  });

  it('drops a picture when its menu loses one', async () => {
    globalThis.fetch = serving({ '/api/products/1/image?v=aaa': 'first' }) as typeof fetch;
    await cacheProductImages([menu(1, '/api/products/1/image?v=aaa')], 1);

    expect(await cacheProductImages([menu(1, null)], 1)).toEqual({ saved: 0, removed: 1, failed: 0 });
    expect(await readProductImages(1)).toEqual([]);
  });

  it('drops a picture when its menu leaves the catalogue', async () => {
    globalThis.fetch = serving({ '/api/products/1/image?v=aaa': 'first' }) as typeof fetch;
    await cacheProductImages([menu(1, '/api/products/1/image?v=aaa')], 1);

    expect(await cacheProductImages([], 1)).toEqual({ saved: 0, removed: 1, failed: 0 });
    expect(await readProductImages(1)).toEqual([]);
  });

  it('keeps one shop out of the other shop pictures', async () => {
    globalThis.fetch = serving({
      '/api/products/1/image?v=aaa': 'first shop',
      '/api/products/2/image?v=bbb': 'second shop',
    }) as typeof fetch;

    await cacheProductImages([menu(1, '/api/products/1/image?v=aaa')], 1);
    await cacheProductImages([menu(2, '/api/products/2/image?v=bbb')], 2);

    expect((await readProductImages(1)).map((r) => r.productId)).toEqual([1]);
    expect((await readProductImages(2)).map((r) => r.productId)).toEqual([2]);
  });

  it('a picture that will not download costs nothing else', async () => {
    globalThis.fetch = serving(
      { '/api/products/2/image?v=bbb': 'second' },
      ['/api/products/1/image?v=aaa'],
    ) as typeof fetch;

    const result = await cacheProductImages([
      menu(1, '/api/products/1/image?v=aaa'),
      menu(2, '/api/products/2/image?v=bbb'),
    ], 1);

    expect(result).toEqual({ saved: 1, removed: 0, failed: 1 });
    expect((await readProductImages(1)).map((r) => r.productId)).toEqual([2]);
  });

  it('survives having no network at all', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const result = await cacheProductImages([menu(1, '/api/products/1/image?v=aaa')], 1);
    expect(result).toEqual({ saved: 0, removed: 0, failed: 1 });
  });
});

describe('readProductImageObjectUrls', () => {
  // jsdom has no object URLs; the browser does. Standing one in keeps the test
  // about which pictures get an address, not about how the address is minted.
  beforeEach(() => {
    let issued = 0;
    URL.createObjectURL = vi.fn(() => `blob:stub/${issued++}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('hands back something an <img> can point at', async () => {
    globalThis.fetch = serving({ '/api/products/1/image?v=aaa': 'first' }) as typeof fetch;
    await cacheProductImages([menu(1, '/api/products/1/image?v=aaa')], 1);

    const urls = await readProductImageObjectUrls(1);
    expect(urls.get(1)).toMatch(/^blob:/);
    expect(urls.has(2)).toBe(false);
  });
});

describe('upgrading a till that is mid-shift', () => {
  /**
   * The photo store arrives at schema version 5. A till upgrading to it may be
   * holding sales that have not reached the server, and those are money: the
   * upgrade has to be additive or it is a data loss bug.
   */
  it('keeps queued sales and everything else through the version 4 to 5 upgrade', async () => {
    const legacy = await openDB(PROMTTAK_POS_DATABASE_NAME, 4, {
      upgrade(database, _oldVersion, _newVersion, transaction) {
        database.createObjectStore('productSnapshot', { keyPath: 'key' });
        database.createObjectStore('metadata', { keyPath: 'key' });
        const orders = database.createObjectStore('offlineOrders', { keyPath: 'localOrderId' });
        orders.createIndex('by-sync-status', 'syncStatus');
        orders.createIndex('by-created-at', 'createdAt');
        orders.createIndex('by-idempotency-key', 'idempotencyKey', { unique: true });
        const items = database.createObjectStore('offlineOrderItems', { keyPath: 'localOrderItemId' });
        items.createIndex('by-local-order', 'localOrderId');
        const movements = database.createObjectStore('offlineStockMovements', { keyPath: 'localMovementId' });
        movements.createIndex('by-local-order', 'localOrderId');
        movements.createIndex('by-product', 'productId');
        database.createObjectStore('offlinePaymentConfig', { keyPath: 'key' });
        void transaction;
      },
    });
    await legacy.put('offlineOrders', {
      localOrderId: 'order-1', localOrderNumber: 'OFF-1', storeId: 1,
      idempotencyKey: 'key-1', createdAt: '2026-09-01T03:00:00.000Z', businessDate: '2026-09-01',
      paymentMethod: 'cash', customerType: 'walkin', subtotal: 138, discount: 0, total: 138,
      status: 'completed', syncStatus: 'pending',
    });
    await legacy.put('offlineOrderItems', {
      localOrderItemId: 'item-1', localOrderId: 'order-1', productId: 1, productName: 'Original',
      productCode: 'ORI', unitPrice: 69, qty: 2, giveawayQty: 0, paidLineSubtotal: 138,
    });
    await legacy.put('offlineStockMovements', {
      localMovementId: 'move-1', localOrderId: 'order-1', referenceId: 'order-1',
      createdAt: '2026-09-01T03:00:00.000Z', businessDate: '2026-09-01',
      productId: 1, semanticType: 'sale', quantity: -2,
    });
    await legacy.put('metadata', {
      key: 'catalog', lastSuccessfulCatalogSyncAt: '2026-09-01T02:00:00.000Z', schemaVersion: 4,
    });
    await legacy.put('productSnapshot', { key: 'confirmed', storeId: 1, products: [menu(1, null)] });
    await legacy.put('offlinePaymentConfig', {
      key: 'promptpay', version: 1, merchantAccountInfo: 'x', provisionedAt: '2026-09-01T02:00:00.000Z',
    });
    legacy.close();

    const upgraded = await openPromttakPosDatabase();
    try {
      expect(upgraded.version).toBe(PROMTTAK_POS_SCHEMA_VERSION);
      expect(upgraded.version).toBe(5);

      const order = await upgraded.get('offlineOrders', 'order-1');
      expect(order?.syncStatus).toBe('pending');
      expect(order?.total).toBe(138);
      expect(order?.idempotencyKey).toBe('key-1');
      expect(await upgraded.getAllFromIndex('offlineOrders', 'by-idempotency-key', 'key-1')).toHaveLength(1);

      expect(await upgraded.getAllFromIndex('offlineOrderItems', 'by-local-order', 'order-1')).toHaveLength(1);
      expect(await upgraded.getAllFromIndex('offlineStockMovements', 'by-local-order', 'order-1')).toHaveLength(1);
      expect((await upgraded.get('productSnapshot', 'confirmed'))?.products).toHaveLength(1);
      expect(await upgraded.get('offlinePaymentConfig', 'promptpay')).toBeTruthy();
      expect(await upgraded.get('metadata', 'catalog')).toBeTruthy();

      // And the new store is there, empty and ready.
      expect(await upgraded.getAll('productImages')).toEqual([]);
    } finally {
      upgraded.close();
    }
  });
});
