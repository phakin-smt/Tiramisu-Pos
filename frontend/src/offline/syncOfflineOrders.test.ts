import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogProduct } from '../types/products';
import { replaceConfirmedCatalogSnapshot, replaceConfirmedCatalogSnapshotIfNoPendingOrders, readConfirmedCatalogSnapshot } from './catalogSnapshot';
import { BAANNOI_POS_DATABASE_NAME, openBaannoiPosDatabase } from './database';
import { refreshOfflineAuthorization } from './offlineAuthorization';
import {
  getPendingOfflineOrderCount,
  getRecentOfflineOrders,
  getUnsyncedOfflineOrderCount,
  recordOfflineCashSale,
  recordOfflineSale,
  retryFailedOfflineOrder,
} from './offlineOrders';
import { getPendingStockReviews, resolveStockReview } from './stockReconciliation';
import { syncPendingOfflineOrders } from './syncOfflineOrders';

const products: CatalogProduct[] = [
  { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 20, minStock: 2, active: true, icon: '🍰' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

const accepted = (orderNumber: string, extra: Record<string, unknown> = {}) => jsonResponse({
  orderNumber, subtotal: 69, discount: 0, vat: 0, total: 69, paymentMethod: 'cash', ...extra,
});

async function seedSale(suffix: string, minute: string, overrides: Record<string, unknown> = {}) {
  return recordOfflineCashSale({ storeId: 1,
    identity: {
      localOrderId: `550e8400-e29b-41d4-a716-4466554${suffix}`,
      localOrderNumber: `OFF-20260821-14${minute}00-${suffix.slice(-4)}`,
      createdAt: `2026-08-21T07:${minute}:00.000Z`,
      businessDate: '2026-08-21',
    },
    idempotencyKey: `aa11bb22-0000-4000-8000-00000${suffix}`,
    order: { items: [{ productId: 1, qty: 1, giveawayQty: 0 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 },
    totals: { subtotal: 69, storeDiscount: 0, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 69 },
    amountTendered: 100,
    changeAmount: 31,
    ...overrides,
  });
}

function bodyOf(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body ?? '{}'));
}

describe('offline order sync', () => {
  beforeEach(async () => {
    await deleteDB(BAANNOI_POS_DATABASE_NAME);
    await replaceConfirmedCatalogSnapshot(products, 1, '2026-08-21T07:00:00.000Z');
    await refreshOfflineAuthorization();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await deleteDB(BAANNOI_POS_DATABASE_NAME);
  });

  it('replays pending sales oldest first and releases the latch when the queue empties', async () => {
    await seedSale('40000', '35');
    await seedSale('40001', '31');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210001'));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await syncPendingOfflineOrders(1);

    expect(outcome).toMatchObject({ synced: 2, failed: 0, remaining: 0, stopped: 'complete', error: '' });
    const sent = fetchMock.mock.calls.map((call) => bodyOf(call).offline.createdAt);
    expect(sent).toEqual(['2026-08-21T07:31:00.000Z', '2026-08-21T07:35:00.000Z']);
    expect(await getUnsyncedOfflineOrderCount(1)).toBe(0);
    expect((await getRecentOfflineOrders(2)).every((order) => order.syncStatus === 'synced')).toBe(true);
  });

  it('sends the original business date and the gross quantity the API expects', async () => {
    await recordOfflineSale({ storeId: 1,
      identity: {
        localOrderId: '550e8400-e29b-41d4-a716-446655440002',
        localOrderNumber: 'OFF-20260821-143500-0002',
        createdAt: '2026-08-21T07:35:00.000Z',
        businessDate: '2026-08-21',
      },
      idempotencyKey: 'aa11bb22-0000-4000-8000-00000040002',
      order: { items: [{ productId: 1, qty: 3, giveawayQty: 1 }], paymentMethod: 'transfer', customerType: 'member', discount: 5 },
      totals: { subtotal: 138, storeDiscount: 0, bundleSets: 0, autoDiscount: 0, discount: 5, vat: 0, grandTotal: 133 },
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210002'));
    vi.stubGlobal('fetch', fetchMock);

    await syncPendingOfflineOrders(1);

    const payload = bodyOf(fetchMock.mock.calls[0]);
    expect(payload.offline).toEqual({
      businessDate: '2026-08-21',
      createdAt: '2026-08-21T07:35:00.000Z',
      localOrderNumber: 'OFF-20260821-143500-0002',
    });
    // Stored qty is net of giveaways; the server derives paid qty from gross.
    expect(payload.items).toEqual([{ productId: 1, qty: 3, giveawayQty: 1 }]);
    expect(payload).toMatchObject({ paymentMethod: 'transfer', customerType: 'member', discount: 5 });
  });

  it('reuses the stored idempotency key so a replay cannot duplicate the sale', async () => {
    await seedSale('40003', '35');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210003', { duplicate: true }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await syncPendingOfflineOrders(1);

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('aa11bb22-0000-4000-8000-0000040003');
    // A duplicate answer is still the server confirming it holds the sale.
    expect(outcome).toMatchObject({ synced: 1, remaining: 0 });
  });

  it('stops at the first transport failure and leaves the rest pending', async () => {
    await seedSale('40004', '31');
    await seedSale('40005', '35');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return accepted('202608210004');
      throw new TypeError('Failed to fetch');
    }));

    const outcome = await syncPendingOfflineOrders(1);

    expect(outcome).toMatchObject({ synced: 1, failed: 0, remaining: 1, stopped: 'offline' });
    expect(await getPendingOfflineOrderCount(1)).toBe(1);
  });

  it('flags a rejected sale and keeps draining the rest of the queue', async () => {
    await seedSale('40006', '31');
    await seedSale('40007', '35');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: 'สินค้าในตะกร้าไม่ถูกต้อง' }, 400) : accepted('202608210007');
    }));

    const outcome = await syncPendingOfflineOrders(1);

    // One poison order must not strand the whole day behind it.
    expect(outcome).toMatchObject({ synced: 1, failed: 1, remaining: 1, stopped: 'complete' });
    const orders = await getRecentOfflineOrders(2);
    const rejected = orders.find((entry) => entry.syncStatus === 'failed');
    expect(rejected?.syncError).toBe('สินค้าในตะกร้าไม่ถูกต้อง');
    // Failed still counts as unsynced, so Local Mode stays latched.
    expect(await getUnsyncedOfflineOrderCount(1)).toBe(1);
    expect(await getPendingOfflineOrderCount(1)).toBe(0);
  });

  it('records a stock review when the server floored stock at zero', async () => {
    await seedSale('40008', '35');
    const shortfalls = [{ productId: 1, productName: 'Original', shortfall: 3 }];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210008', { stockReview: true, stockShortfalls: shortfalls })));

    const outcome = await syncPendingOfflineOrders(1);

    expect(outcome).toMatchObject({ synced: 1, stockReviews: 1, remaining: 0 });
    expect((await getRecentOfflineOrders(1))[0]).toMatchObject({ syncStatus: 'synced', stockReview: true, stockShortfalls: shortfalls });
    expect(await getPendingStockReviews(1)).toEqual([
      { productId: 1, productName: 'Original', discrepancy: 3, localOrderIds: ['550e8400-e29b-41d4-a716-446655440008'] },
    ]);
  });

  it('keeps the review outstanding across a catalog refresh and a fresh read', async () => {
    await seedSale('40011', '35');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210011', {
      stockReview: true, stockShortfalls: [{ productId: 1, productName: 'Original', shortfall: 2 }],
    })));
    await syncPendingOfflineOrders(1);

    // The queue is empty, so a server catalog refresh is allowed again.
    expect(await replaceConfirmedCatalogSnapshotIfNoPendingOrders(products, 1, '2026-08-21T08:00:00.000Z')).not.toBeNull();

    // Overwriting the catalog must not erase the outstanding review.
    expect(await getPendingStockReviews(1)).toEqual([
      { productId: 1, productName: 'Original', discrepancy: 2, localOrderIds: ['550e8400-e29b-41d4-a716-446655440011'] },
    ]);
  });

  it('only an explicit reconciliation clears the review', async () => {
    await seedSale('40012', '35');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210012', {
      stockReview: true, stockShortfalls: [{ productId: 1, productName: 'Original', shortfall: 2 }],
    })));
    await syncPendingOfflineOrders(1);

    // A second drain finds nothing pending and must not silently resolve it.
    await syncPendingOfflineOrders(1);
    expect(await getPendingStockReviews(1)).toHaveLength(1);

    await resolveStockReview(1, 1);
    expect(await getPendingStockReviews(1)).toEqual([]);
    // The order itself is untouched apart from the resolution marker.
    expect((await getRecentOfflineOrders(1))[0]).toMatchObject({
      syncStatus: 'synced', stockReview: true, total: 69, serverOrderNumber: '202608210012',
    });
  });

  it('mints and persists a key for a pre-v4 order instead of stranding it', async () => {
    await seedSale('40009', '35');
    const database = await openBaannoiPosDatabase();
    const legacy = await database.get('offlineOrders', '550e8400-e29b-41d4-a716-446655440009');
    delete legacy!.idempotencyKey;
    await database.put('offlineOrders', legacy!);
    database.close();

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210009'));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await syncPendingOfflineOrders(1);

    expect(outcome).toMatchObject({ synced: 1, failed: 0, remaining: 0 });
    const key = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key'];
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
    // Persisted before sending, so an interrupted drain reuses the same key.
    expect((await getRecentOfflineOrders(1))[0].idempotencyKey).toBe(key);
  });

  it('does not touch the local stock snapshot while syncing', async () => {
    await seedSale('40010', '35');
    const before = (await readConfirmedCatalogSnapshot(1))?.products[0].stock;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210010')));

    await syncPendingOfflineOrders(1);

    expect((await readConfirmedCatalogSnapshot(1))?.products[0].stock).toBe(before);
  });

  it('replays a retried order under its original key and deducts stock once', async () => {
    await seedSale('40013', '35');
    let attempts = 0;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      attempts += 1;
      // First drain is refused; the retry then succeeds.
      return attempts === 1
        ? jsonResponse({ error: 'ระบบหรือฐานข้อมูลไม่พร้อมใช้งาน' }, 500)
        : accepted('202608210013', { duplicate: attempts > 2 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await syncPendingOfflineOrders(1);
    expect((await getRecentOfflineOrders(1))[0].syncStatus).toBe('failed');

    await retryFailedOfflineOrder('550e8400-e29b-41d4-a716-446655440013');
    await syncPendingOfflineOrders(1);
    // A third drain must find nothing left to send.
    await syncPendingOfflineOrders(1);

    const keys = fetchMock.mock.calls.map((call) => (call[1]?.headers as Record<string, string>)['Idempotency-Key']);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('aa11bb22-0000-4000-8000-0000040013');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const order = (await getRecentOfflineOrders(1))[0];
    expect(order).toMatchObject({ syncStatus: 'synced', serverOrderNumber: '202608210013' });
    expect(order.syncError).toBeUndefined();
    expect(await getUnsyncedOfflineOrderCount(1)).toBe(0);
  });

  it('loses nothing when connectivity dies mid-drain and completes after a retry', async () => {
    await seedSale('40014', '31');
    await seedSale('40015', '33');
    await seedSale('40016', '35');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return accepted('202608210014');
      throw new TypeError('Failed to fetch');
    }));

    const interrupted = await syncPendingOfflineOrders(1);
    expect(interrupted).toMatchObject({ synced: 1, failed: 0, remaining: 2, stopped: 'offline' });
    // Nothing was dropped: both survivors are still queued, not lost.
    expect(await getPendingOfflineOrderCount(1)).toBe(2);

    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => accepted('202608210015')));
    const completed = await syncPendingOfflineOrders(1);

    expect(completed).toMatchObject({ synced: 2, failed: 0, remaining: 0, stopped: 'complete' });
    expect(await getUnsyncedOfflineOrderCount(1)).toBe(0);
    expect((await getRecentOfflineOrders(3)).every((entry) => entry.syncStatus === 'synced')).toBe(true);
  });

  it('is a no-op with an empty queue', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await syncPendingOfflineOrders(1)).toMatchObject({ synced: 0, failed: 0, remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
