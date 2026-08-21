import { useCallback, useEffect, useState } from 'react';

import { getProducts } from '../../api/products';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { readConfirmedCatalogSnapshot, replaceConfirmedCatalogSnapshotIfNoPendingOrders } from '../../offline/catalogSnapshot';
import { getPendingOfflineOrderCount } from '../../offline/offlineOrders';
import type { CatalogProduct } from '../../types/products';

export type CatalogDataSource = 'server' | 'cache-offline' | 'cache-fallback' | 'cache-pending-sync';

interface ProductsState {
  data: CatalogProduct[] | null;
  loading: boolean;
  error: string;
  storageError: string;
  source: CatalogDataSource | null;
  lastSuccessfulCatalogSyncAt: string | null;
  pendingOfflineOrderCount: number;
}

const initialState: ProductsState = {
  data: null,
  loading: true,
  error: '',
  storageError: '',
  source: null,
  lastSuccessfulCatalogSyncAt: null,
  pendingOfflineOrderCount: 0,
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useProducts() {
  const { isOnline } = useConnectivity();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ProductsState>(initialState);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    setState((previous) => ({ ...previous, loading: true, error: '', storageError: '' }));

    async function loadProducts() {
      if (!isOnline) {
        try {
          const [snapshot, pendingOfflineOrderCount] = await Promise.all([
            readConfirmedCatalogSnapshot(),
            getPendingOfflineOrderCount(),
          ]);
          if (!current) return;
          setState({
            data: snapshot?.products ?? null,
            loading: false,
            error: '',
            storageError: '',
            source: snapshot ? 'cache-offline' : null,
            lastSuccessfulCatalogSyncAt: snapshot?.metadata.lastSuccessfulCatalogSyncAt ?? null,
            pendingOfflineOrderCount,
          });
        } catch (error) {
          if (!current) return;
          setState({
            data: null,
            loading: false,
            error: '',
            storageError: errorMessage(error, 'ไม่สามารถอ่านข้อมูลสินค้าออฟไลน์ได้'),
            source: null,
            lastSuccessfulCatalogSyncAt: null,
            pendingOfflineOrderCount: 0,
          });
        }
        return;
      }

      try {
        const products = await getProducts(controller.signal);
        if (!current) return;

        let metadata;
        try {
          metadata = await replaceConfirmedCatalogSnapshotIfNoPendingOrders(products);
        } catch (error) {
          if (!current) return;
          setState((previous) => ({
            data: products,
            loading: false,
            error: '',
            storageError: errorMessage(error, 'ไม่สามารถบันทึกข้อมูลสินค้าออฟไลน์ได้'),
            source: 'server',
            lastSuccessfulCatalogSyncAt: previous.lastSuccessfulCatalogSyncAt,
            pendingOfflineOrderCount: previous.pendingOfflineOrderCount,
          }));
          return;
        }
        if (!current) return;
        if (!metadata) {
          const pendingOfflineOrderCount = await getPendingOfflineOrderCount();
          const snapshot = await readConfirmedCatalogSnapshot();
          if (!current) return;
          setState({
            data: snapshot?.products ?? null,
            loading: false,
            error: '',
            storageError: '',
            source: snapshot ? 'cache-pending-sync' : null,
            lastSuccessfulCatalogSyncAt: snapshot?.metadata.lastSuccessfulCatalogSyncAt ?? null,
            pendingOfflineOrderCount,
          });
          return;
        }

        setState((previous) => ({
          data: products,
          loading: false,
          error: '',
          storageError: '',
          source: 'server',
          lastSuccessfulCatalogSyncAt: metadata.lastSuccessfulCatalogSyncAt,
          pendingOfflineOrderCount: 0,
        }));
      } catch (error) {
        if (!current || controller.signal.aborted) return;
        const networkError = errorMessage(error, 'ไม่สามารถโหลดข้อมูลสินค้าได้');
        try {
          const [snapshot, pendingOfflineOrderCount] = await Promise.all([
            readConfirmedCatalogSnapshot(),
            getPendingOfflineOrderCount(),
          ]);
          if (!current) return;
          setState((previous) => ({
            data: snapshot?.products ?? previous.data,
            loading: false,
            error: networkError,
            storageError: '',
            source: snapshot ? 'cache-fallback' : previous.source,
            lastSuccessfulCatalogSyncAt: snapshot?.metadata.lastSuccessfulCatalogSyncAt
              ?? previous.lastSuccessfulCatalogSyncAt,
            pendingOfflineOrderCount,
          }));
        } catch (storageError) {
          if (!current) return;
          setState((previous) => ({
            ...previous,
            loading: false,
            error: networkError,
            storageError: errorMessage(storageError, 'ไม่สามารถอ่านข้อมูลสินค้าออฟไลน์ได้'),
          }));
        }
      }
    }

    void loadProducts();
    return () => {
      current = false;
      controller.abort();
    };
  }, [isOnline, revision]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  return {
    ...state,
    isCached: state.source === 'cache-offline' || state.source === 'cache-fallback' || state.source === 'cache-pending-sync',
    offlineUnavailable: !isOnline && !state.loading && state.data === null,
    refresh,
  };
}
