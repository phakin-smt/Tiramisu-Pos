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
    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.lastSuccessfulCatalogSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/));
    expect(result.current.data).toEqual(products);
    const snapshot = await readConfirmedCatalogSnapshot();
    expect(snapshot?.products).toEqual(products);
    expect(snapshot?.metadata.lastSuccessfulCatalogSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves and returns the previous snapshot when the online API fails', async () => {
    const syncedAt = '2026-08-21T04:30:00.000Z';
    await replaceConfirmedCatalogSnapshot(products, syncedAt);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));
    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.source).toBe('cache-fallback'));
    expect(result.current.data).toEqual(products);
    expect(result.current.error).toBe('network unavailable');
    expect((await readConfirmedCatalogSnapshot())?.metadata.lastSuccessfulCatalogSyncAt).toBe(syncedAt);
  });

  it('reads IndexedDB without making a network request when offline', async () => {
    await replaceConfirmedCatalogSnapshot(products, '2026-08-21T04:30:00.000Z');
    setNavigatorOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.source).toBe('cache-offline'));
    expect(result.current.data).toEqual(products);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
