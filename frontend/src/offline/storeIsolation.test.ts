import { beforeEach, describe, expect, it, vi } from 'vitest';

import { replaceConfirmedCatalogSnapshot, readConfirmedCatalogSnapshot } from './catalogSnapshot';
import { refreshOfflineAuthorization } from './offlineAuthorization';
import {
  createOfflineOrderIdentity,
  getOfflineOrdersToSync,
  getUnsyncedOfflineOrderCount,
  getUnsyncedOfflineOrders,
  recordOfflineSale,
} from './offlineOrders';
import { openBaannoiPosDatabase } from './database';
import { syncPendingOfflineOrders } from './syncOfflineOrders';
import type { CatalogProduct } from '../types/products';
import type { CreateOrderRequest } from '../types/checkout';

const DESSERT = 1;
const PASTA = 2;

function product(id: number, name: string, price: number): CatalogProduct {
  return {
    id, code: `C${id}`, barcode: null, name, category: 'Tiramisu',
    price, cost: 10, stock: 20, minStock: 1, active: true, icon: '🍰',
  };
}

function order(productId: number): CreateOrderRequest {
  return {
    items: [{ productId, qty: 1, giveawayQty: 0 }],
    paymentMethod: 'cash',
    customerType: 'walkin',
    discount: 0,
  };
}

const totals = {
  subtotal: 69, bundleSets: 0, storeDiscount: 0, autoDiscount: 0,
  discount: 0, vat: 0, grandTotal: 69,
};

async function sell(storeId: number, productId: number, key: string) {
  return recordOfflineSale({
    storeId,
    identity: createOfflineOrderIdentity(),
    order: order(productId),
    idempotencyKey: key,
    totals,
    amountTendered: 100,
    changeAmount: 31,
  });
}

describe('offline sales stay with the store that made them', () => {
  beforeEach(async () => {
    await refreshOfflineAuthorization();
  });

  it('records which store a sale was rung up for', async () => {
    await replaceConfirmedCatalogSnapshot([product(1, 'Original', 69)], DESSERT);
    const saved = await sell(DESSERT, 1, 'key-dessert');
    expect(saved.storeId).toBe(DESSERT);
  });

  it('counts and lists only the selling store as waiting to sync', async () => {
    await replaceConfirmedCatalogSnapshot([product(1, 'Original', 69)], DESSERT);
    await sell(DESSERT, 1, 'key-dessert');

    expect(await getUnsyncedOfflineOrderCount(DESSERT)).toBe(1);
    expect(await getUnsyncedOfflineOrderCount(PASTA)).toBe(0);
    expect(await getUnsyncedOfflineOrders(PASTA)).toEqual([]);
    expect(await getOfflineOrdersToSync(PASTA)).toEqual([]);
  });

  it('never posts one shop takings while the other shop is selected', async () => {
    await replaceConfirmedCatalogSnapshot([product(1, 'Original', 69)], DESSERT);
    await sell(DESSERT, 1, 'key-dessert');

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // The wrong shop is selected. The sale is left where it is rather than being
    // filed under a store that never made it.
    const outcome = await syncPendingOfflineOrders(PASTA);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.synced).toBe(0);

    // It is still there, still waiting for its own store.
    expect(await getUnsyncedOfflineOrderCount(DESSERT)).toBe(1);
  });

  it('treats a sale saved before stores existed as the first store', async () => {
    await replaceConfirmedCatalogSnapshot([product(1, 'Original', 69)], DESSERT);
    const saved = await sell(DESSERT, 1, 'key-legacy');

    // Strip the marker the way a pre-upgrade record would have been written.
    const database = await openBaannoiPosDatabase();
    const { storeId: _dropped, ...legacy } = saved;
    await database.put('offlineOrders', legacy);
    database.close();

    expect(await getUnsyncedOfflineOrderCount(DESSERT)).toBe(1);
    expect(await getUnsyncedOfflineOrderCount(PASTA)).toBe(0);
  });

  it('will not show one store the catalogue cached for another', async () => {
    await replaceConfirmedCatalogSnapshot([product(1, 'Original', 69)], DESSERT);

    expect((await readConfirmedCatalogSnapshot(DESSERT))?.products).toHaveLength(1);
    // Better no menu than the wrong shop's menu and prices.
    expect(await readConfirmedCatalogSnapshot(PASTA)).toBeNull();
  });
});
