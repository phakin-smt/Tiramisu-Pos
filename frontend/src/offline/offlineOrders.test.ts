import 'fake-indexeddb/auto';

import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogProduct } from '../types/products';
import { replaceConfirmedCatalogSnapshot, readConfirmedCatalogSnapshot } from './catalogSnapshot';
import {
  BAANNOI_POS_DATABASE_NAME,
  BAANNOI_POS_SCHEMA_VERSION,
  openBaannoiPosDatabase,
} from './database';
import { refreshOfflineAuthorization } from './offlineAuthorization';
import {
  createOfflineOrderIdentity,
  getOfflineOrderDetails,
  getPendingOfflineOrderCount,
  getRecentOfflineOrders,
  INSUFFICIENT_OFFLINE_STOCK_MESSAGE,
  recordOfflineCashSale,
} from './offlineOrders';

const products: CatalogProduct[] = [
  { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
  { id: 2, code: 'OLD', barcode: null, name: 'Inactive Stocked', category: 'Bakery', price: 50, cost: 18, stock: 2, minStock: 1, active: false, icon: '🍪' },
];

const identity = {
  localOrderId: '550e8400-e29b-41d4-a716-446655440000',
  localOrderNumber: 'OFF-20260821-143522-0000',
  createdAt: '2026-08-21T07:35:22.000Z',
  businessDate: '2026-08-21',
};

function sale(overrides: Partial<Parameters<typeof recordOfflineCashSale>[0]> = {}) {
  return recordOfflineCashSale({
    identity,
    order: {
      items: [{ productId: 1, qty: 3, giveawayQty: 1 }],
      paymentMethod: 'cash',
      customerType: 'walkin',
      discount: 0,
    },
    totals: { subtotal: 138, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 138 },
    amountTendered: 500,
    changeAmount: 362,
    ...overrides,
  });
}

describe('offline cash order transaction', () => {
  beforeEach(async () => {
    await deleteDB(BAANNOI_POS_DATABASE_NAME);
    await replaceConfirmedCatalogSnapshot(products, '2026-08-21T07:00:00.000Z');
    await refreshOfflineAuthorization();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteDB(BAANNOI_POS_DATABASE_NAME);
  });

  it('persists immutable totals, line snapshots, tender and split stock movements atomically', async () => {
    const order = await sale();
    expect(order).toMatchObject({
      ...identity, paymentMethod: 'cash', subtotal: 138, discount: 0, total: 138,
      amountTendered: 500, changeAmount: 362, status: 'completed', syncStatus: 'pending',
    });
    const details = await getOfflineOrderDetails(identity.localOrderId);
    expect(details?.items).toEqual([expect.objectContaining({
      productName: 'Original', productCode: 'ORI', unitPrice: 69,
      qty: 2, giveawayQty: 1, paidLineSubtotal: 138,
    })]);
    expect(details?.movements).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticType: 'sale', quantity: -2, referenceId: identity.localOrderId }),
      expect.objectContaining({ semanticType: 'giveaway', quantity: -1, referenceId: identity.localOrderId }),
    ]));
    expect((await readConfirmedCatalogSnapshot())?.products[0].stock).toBe(7);
    expect(await getPendingOfflineOrderCount()).toBe(1);
    expect((await getRecentOfflineOrders(1))[0].total).toBe(138);
  });

  it('creates a stable UUID and Bangkok display identity', () => {
    const generated = createOfflineOrderIdentity(new Date('2026-08-21T07:35:22.000Z'));
    expect(generated.localOrderId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(generated.localOrderNumber).toMatch(/^OFF-20260821-143522-[0-9A-F]{4}$/);
    expect(generated.businessDate).toBe('2026-08-21');
  });

  it('does not create a zero giveaway movement and supports an inactive stocked cached product', async () => {
    await sale({
      order: { items: [{ productId: 2, qty: 1, giveawayQty: 0 }], paymentMethod: 'cash', customerType: 'store', discount: 0 },
      totals: { subtotal: 50, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 50 },
      amountTendered: 50,
      changeAmount: 0,
    });
    const details = await getOfflineOrderDetails(identity.localOrderId);
    expect(details?.movements).toHaveLength(1);
    expect(details?.movements[0]).toMatchObject({ semanticType: 'sale', quantity: -1 });
    expect((await readConfirmedCatalogSnapshot())?.products[1].stock).toBe(1);
  });

  it('aborts every write when current local stock is insufficient', async () => {
    await expect(sale({ order: { items: [{ productId: 1, qty: 11, giveawayQty: 0 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 } }))
      .rejects.toThrow(INSUFFICIENT_OFFLINE_STOCK_MESSAGE);
    expect(await getPendingOfflineOrderCount()).toBe(0);
    expect((await readConfirmedCatalogSnapshot())?.products[0].stock).toBe(10);
    expect(await getOfflineOrderDetails(identity.localOrderId)).toBeNull();
  });

  it.each([
    ['missing', null],
    ['expired', new Date(Date.now() - (8 * 24 * 60 * 60 * 1000))],
  ])('blocks checkout when offline authorization is %s', async (_reason, enabledAt) => {
    if (enabledAt) {
      await refreshOfflineAuthorization(enabledAt);
    } else {
      const database = await openBaannoiPosDatabase();
      await database.delete('metadata', 'offlineAuthorization');
      database.close();
    }
    await expect(sale()).rejects.toThrow('อุปกรณ์นี้ยังไม่พร้อมสำหรับการขายออฟไลน์');
    expect(await getPendingOfflineOrderCount()).toBe(0);
    expect((await readConfirmedCatalogSnapshot())?.products[0].stock).toBe(10);
  });

  it.each([
    ['order write', 'offlineOrders', 'add'],
    ['stock write', 'productSnapshot', 'put'],
  ] as const)('rolls back snapshot and records after a failed %s', async (_label, storeName, operation) => {
    if (operation === 'add') {
      const original = IDBObjectStore.prototype.add;
      vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
        if (this.name === storeName) throw new DOMException('injected write failure', 'UnknownError');
        return original.call(this, value, key);
      });
    } else {
      const original = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
        if (this.name === storeName) throw new DOMException('injected write failure', 'UnknownError');
        return original.call(this, value, key);
      });
    }
    await expect(sale()).rejects.toThrow('injected write failure');
    expect((await readConfirmedCatalogSnapshot())?.products[0].stock).toBe(10);
    expect(await getPendingOfflineOrderCount()).toBe(0);
    const database = await openBaannoiPosDatabase();
    expect(await database.count('offlineOrderItems')).toBe(0);
    expect(await database.count('offlineStockMovements')).toBe(0);
    database.close();
  });

  it('reuses one local identity so concurrent duplicate confirmation creates exactly one order', async () => {
    const [first, second] = await Promise.all([sale(), sale()]);
    expect(first.localOrderId).toBe(second.localOrderId);
    expect(await getPendingOfflineOrderCount()).toBe(1);
    expect((await readConfirmedCatalogSnapshot())?.products[0].stock).toBe(7);
  });
});

describe('BaannoiPOS v1 to v2 migration', () => {
  beforeEach(async () => deleteDB(BAANNOI_POS_DATABASE_NAME));
  afterEach(async () => deleteDB(BAANNOI_POS_DATABASE_NAME));

  it('preserves the Phase 2 catalog and metadata while adding only Phase 3 stores', async () => {
    const versionOne = await openDB(BAANNOI_POS_DATABASE_NAME, 1, {
      upgrade(database) {
        database.createObjectStore('productSnapshot', { keyPath: 'key' });
        database.createObjectStore('metadata', { keyPath: 'key' });
      },
    });
    await versionOne.put('productSnapshot', { key: 'confirmed', products });
    await versionOne.put('metadata', { key: 'catalog', lastSuccessfulCatalogSyncAt: '2026-08-20T03:00:00.000Z', schemaVersion: 1 });
    versionOne.close();

    const upgraded = await openBaannoiPosDatabase();
    expect(upgraded.version).toBe(BAANNOI_POS_SCHEMA_VERSION);
    expect([...upgraded.objectStoreNames]).toEqual([
      'metadata', 'offlineOrderItems', 'offlineOrders', 'offlineStockMovements', 'productSnapshot',
    ]);
    upgraded.close();
    expect(await readConfirmedCatalogSnapshot()).toEqual({
      products,
      metadata: { key: 'catalog', lastSuccessfulCatalogSyncAt: '2026-08-20T03:00:00.000Z', schemaVersion: 1 },
    });
  });
});
