import 'fake-indexeddb/auto';

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectivityProvider } from '../../connectivity/ConnectivityContext';
import {
  BAANNOI_POS_DATABASE_NAME,
  readConfirmedCatalogSnapshot,
  replaceConfirmedCatalogSnapshot,
} from '../../offline/catalogSnapshot';
import { refreshOfflineAuthorization } from '../../offline/offlineAuthorization';
import { recordOfflineCashSale } from '../../offline/offlineOrders';
import type { CatalogProduct } from '../../types/products';
import { useProducts } from './useProducts';

const products: CatalogProduct[] = [
  { id: 1, code: 'ORI', barcode: null, name: 'Original', category: 'Tiramisu', price: 69, cost: 25, stock: 10, minStock: 2, active: true, icon: '🍰' },
];

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectivityProvider>{children}</ConnectivityProvider>
);

describe('useProducts offline snapshot behavior', () => {
  beforeEach(async () => {
    await deleteDB(BAANNOI_POS_DATABASE_NAME);
    setNavigatorOnline(true);
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    setNavigatorOnline(true);
    await deleteDB(BAANNOI_POS_DATABASE_NAME);
  });

  it('writes the complete snapshot only after a successful API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(products)));
    const { result } = renderHook(() => useProducts(1), { wrapper });

    await waitFor(() => expect(result.current.lastSuccessfulCatalogSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/));
    expect(result.current.data).toEqual(products);
    const snapshot = await readConfirmedCatalogSnapshot(1);
    expect(snapshot?.products).toEqual(products);
    expect(snapshot?.metadata.lastSuccessfulCatalogSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves and returns the previous snapshot when the online API fails', async () => {
    const syncedAt = '2026-08-21T04:30:00.000Z';
    await replaceConfirmedCatalogSnapshot(products, 1, syncedAt);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));
    const { result } = renderHook(() => useProducts(1), { wrapper });

    await waitFor(() => expect(result.current.source).toBe('cache-fallback'));
    expect(result.current.data).toEqual(products);
    expect(result.current.error).toBe('network unavailable');
    expect((await readConfirmedCatalogSnapshot(1))?.metadata.lastSuccessfulCatalogSyncAt).toBe(syncedAt);
  });

  it('reads IndexedDB without making a network request when offline', async () => {
    await replaceConfirmedCatalogSnapshot(products, 1, '2026-08-21T04:30:00.000Z');
    setNavigatorOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useProducts(1), { wrapper });

    await waitFor(() => expect(result.current.source).toBe('cache-offline'));
    expect(result.current.data).toEqual(products);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves locally reduced stock when pending offline orders exist after reconnect', async () => {
    await replaceConfirmedCatalogSnapshot(products, 1, '2026-08-21T04:30:00.000Z');
    await refreshOfflineAuthorization();
    const createdAt = new Date().toISOString();
    await recordOfflineCashSale({ storeId: 1,
      identity: {
        localOrderId: '550e8400-e29b-41d4-a716-446655440000',
        localOrderNumber: 'OFF-20260821-143522-0000',
        createdAt,
        businessDate: '2026-08-21',
      },
      order: { items: [{ productId: 1, qty: 3, giveawayQty: 1 }], paymentMethod: 'cash', customerType: 'walkin', discount: 0 },
      totals: { subtotal: 138, storeDiscount: 0, bundleSets: 0, autoDiscount: 0, discount: 0, vat: 0, grandTotal: 138 },
      amountTendered: 200,
      changeAmount: 62,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(products)));

    const { result } = renderHook(() => useProducts(1), { wrapper });
    await waitFor(() => expect(result.current.source).toBe('cache-pending-sync'));
    expect(result.current.data?.[0].stock).toBe(7);
    expect(result.current.unsyncedOfflineOrderCount).toBe(1);
    expect((await readConfirmedCatalogSnapshot(1))?.products[0].stock).toBe(7);
  });
});
