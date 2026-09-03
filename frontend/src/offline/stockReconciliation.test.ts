import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BAANNOI_POS_DATABASE_NAME, openBaannoiPosDatabase, type OfflineOrder } from './database';
import {
  getPendingStockReviewCount,
  getPendingStockReviews,
  resolveStockReview,
} from './stockReconciliation';

async function putOrder(order: Partial<OfflineOrder> & { localOrderId: string }) {
  const database = await openBaannoiPosDatabase();
  await database.put('offlineOrders', {
    localOrderNumber: `OFF-${order.localOrderId}`,
    createdAt: '2026-08-21T07:35:00.000Z',
    businessDate: '2026-08-21',
    paymentMethod: 'cash',
    customerType: 'walkin',
    subtotal: 69,
    discount: 0,
    total: 69,
    status: 'completed',
    syncStatus: 'synced',
    ...order,
  } as OfflineOrder);
  database.close();
}

async function readOrder(localOrderId: string) {
  const database = await openBaannoiPosDatabase();
  try {
    return await database.get('offlineOrders', localOrderId);
  } finally {
    database.close();
  }
}

const tiramisu = { productId: 1, productName: 'ทีรามิสุ Original', shortfall: 2 };

beforeEach(async () => { await deleteDB(BAANNOI_POS_DATABASE_NAME); });
afterEach(async () => { await deleteDB(BAANNOI_POS_DATABASE_NAME); });

describe('offline stock review aggregation', () => {
  it('reports nothing when no synced order raised a review', async () => {
    await putOrder({ localOrderId: 'a', createdAt: '2026-08-21T07:30:00.000Z' });
    expect(await getPendingStockReviews(1)).toEqual([]);
    expect(await getPendingStockReviewCount(1)).toBe(0);
  });

  it('exposes one entry per product with the units the server could not deduct', async () => {
    await putOrder({ localOrderId: 'a', stockReview: true, stockShortfalls: [tiramisu] });

    expect(await getPendingStockReviews(1)).toEqual([
      { productId: 1, productName: 'ทีรามิสุ Original', discrepancy: 2, localOrderIds: ['a'] },
    ]);
  });

  it('adds up two offline orders for the same product without double counting', async () => {
    await putOrder({ localOrderId: 'a', createdAt: '2026-08-21T07:31:00.000Z', stockReview: true, stockShortfalls: [{ ...tiramisu, shortfall: 1 }] });
    await putOrder({ localOrderId: 'b', createdAt: '2026-08-21T07:35:00.000Z', stockReview: true, stockShortfalls: [{ ...tiramisu, shortfall: 2 }] });

    const [entry] = await getPendingStockReviews(1);
    expect(entry).toEqual({ productId: 1, productName: 'ทีรามิสุ Original', discrepancy: 3, localOrderIds: ['a', 'b'] });
    // Reading twice must not accumulate.
    expect((await getPendingStockReviews(1))[0].discrepancy).toBe(3);
  });

  it('keeps separate products separate', async () => {
    await putOrder({
      localOrderId: 'a',
      stockReview: true,
      stockShortfalls: [tiramisu, { productId: 2, productName: 'Bakery', shortfall: 5 }],
    });

    const reviews = await getPendingStockReviews(1);
    expect(reviews.map((entry) => [entry.productId, entry.discrepancy])).toEqual([[2, 5], [1, 2]]);
    expect(await getPendingStockReviewCount(1)).toBe(2);
  });

  it('resolves one product across every order that raised it', async () => {
    await putOrder({ localOrderId: 'a', createdAt: '2026-08-21T07:31:00.000Z', stockReview: true, stockShortfalls: [{ ...tiramisu, shortfall: 1 }] });
    await putOrder({ localOrderId: 'b', createdAt: '2026-08-21T07:35:00.000Z', stockReview: true, stockShortfalls: [{ ...tiramisu, shortfall: 2 }] });

    expect(await resolveStockReview(1, 1)).toBe(2);

    expect(await getPendingStockReviews(1)).toEqual([]);
    for (const id of ['a', 'b']) {
      const order = await readOrder(id);
      // History is preserved: only the resolution is added.
      expect(order?.stockReview).toBe(true);
      expect(order?.stockShortfalls).toHaveLength(1);
      expect(order?.stockReviewResolvedProductIds).toEqual([1]);
      expect(order?.stockReviewResolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('leaves a second product outstanding when only one was counted', async () => {
    await putOrder({
      localOrderId: 'a',
      stockReview: true,
      stockShortfalls: [tiramisu, { productId: 2, productName: 'Bakery', shortfall: 5 }],
    });

    await resolveStockReview(1, 1);

    expect(await getPendingStockReviews(1)).toEqual([
      { productId: 2, productName: 'Bakery', discrepancy: 5, localOrderIds: ['a'] },
    ]);
    const order = await readOrder('a');
    expect(order?.stockReviewResolvedProductIds).toEqual([1]);
    // Not fully settled yet, so no completion stamp.
    expect(order?.stockReviewResolvedAt).toBeUndefined();

    await resolveStockReview(1, 2);
    expect(await getPendingStockReviews(1)).toEqual([]);
    expect((await readOrder('a'))?.stockReviewResolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('is idempotent so a repeated resolve cannot corrupt the record', async () => {
    await putOrder({ localOrderId: 'a', stockReview: true, stockShortfalls: [tiramisu] });

    expect(await resolveStockReview(1, 1)).toBe(1);
    expect(await resolveStockReview(1, 1)).toBe(0);
    expect((await readOrder('a'))?.stockReviewResolvedProductIds).toEqual([1]);
  });

  it('ignores a product that never had a review', async () => {
    await putOrder({ localOrderId: 'a', stockReview: true, stockShortfalls: [tiramisu] });

    expect(await resolveStockReview(1, 999)).toBe(0);
    expect((await getPendingStockReviews(1))[0].discrepancy).toBe(2);
  });

  it('survives a reload by reading straight from IndexedDB', async () => {
    await putOrder({ localOrderId: 'a', stockReview: true, stockShortfalls: [tiramisu] });

    // A fresh connection is exactly what a reloaded page gets.
    expect(await getPendingStockReviewCount(1)).toBe(1);
    expect(await getPendingStockReviewCount(1)).toBe(1);
  });

  it('does not resurrect a review once every product is settled', async () => {
    await putOrder({ localOrderId: 'a', stockReview: true, stockShortfalls: [tiramisu] });
    await resolveStockReview(1, 1);

    await putOrder({ localOrderId: 'b', stockReview: true, stockShortfalls: [{ ...tiramisu, shortfall: 4 }] });

    // Only the new order counts; the settled one stays settled.
    expect(await getPendingStockReviews(1)).toEqual([
      { productId: 1, productName: 'ทีรามิสุ Original', discrepancy: 4, localOrderIds: ['b'] },
    ]);
  });
});
