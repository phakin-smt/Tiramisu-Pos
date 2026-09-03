import { useCallback, useEffect, useState } from 'react';

import { getProducts } from '../../api/products';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { readConfirmedCatalogSnapshot, replaceConfirmedCatalogSnapshotIfNoPendingOrders } from '../../offline/catalogSnapshot';
import { getUnsyncedOfflineOrderCount } from '../../offline/offlineOrders';
import type { CatalogProduct } from '../../types/products';

export type CatalogDataSource = 'server' | 'cache-offline' | 'cache-fallback' | 'cache-pending-sync';

interface ProductsState {
  data: CatalogProduct[] | null;
  loading: boolean;
  error: string;
  storageError: string;
  source: CatalogDataSource | null;
  lastSuccessfulCatalogSyncAt: string | null;
  unsyncedOfflineOrderCount: number;
}

const initialState: ProductsState = {
  data: null,
  loading: true,
  error: '',
  storageError: '',
  source: null,
  lastSuccessfulCatalogSyncAt: null,
  unsyncedOfflineOrderCount: 0,
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useProducts(storeId: number | null) {
  const { isOnline } = useConnectivity();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ProductsState>(initialState);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    setState((previous) => ({ ...previous, loading: true, error: '', storageError: '' }));

    async function loadProducts() {
      // Until the store is settled there is no catalogue to speak of: reading one
      // would risk showing another shop's menu. Settle rather than hang, so the
      // page says it has nothing instead of spinning forever.
      if (storeId === null) {
        if (current) setState({ ...initialState, loading: false });
        return;
      }
      if (!isOnline) {
        try {
          const [snapshot, unsyncedOfflineOrderCount] = await Promise.all([
            readConfirmedCatalogSnapshot(storeId),
            getUnsyncedOfflineOrderCount(storeId),
          ]);
          if (!current) return;
          setState({
            data: snapshot?.products ?? null,
            loading: false,
            error: '',
            storageError: '',
            source: snapshot ? 'cache-offline' : null,
            lastSuccessfulCatalogSyncAt: snapshot?.metadata.lastSuccessfulCatalogSyncAt ?? null,
            unsyncedOfflineOrderCount,
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
            unsyncedOfflineOrderCount: 0,
          });
        }
        return;
      }

      try {
        const products = await getProducts(controller.signal);
        if (!current) return;

        let metadata;
        try {
          metadata = await replaceConfirmedCatalogSnapshotIfNoPendingOrders(products, storeId);
        } catch (error) {
          if (!current) return;
          setState((previous) => ({
            data: products,
            loading: false,
            error: '',
            storageError: errorMessage(error, 'ไม่สามารถบันทึกข้อมูลสินค้าออฟไลน์ได้'),
            source: 'server',
            lastSuccessfulCatalogSyncAt: previous.lastSuccessfulCatalogSyncAt,
            unsyncedOfflineOrderCount: previous.unsyncedOfflineOrderCount,
          }));
          return;
        }
        if (!current) return;
        if (!metadata) {
          const unsyncedOfflineOrderCount = await getUnsyncedOfflineOrderCount(storeId);
          const snapshot = await readConfirmedCatalogSnapshot(storeId);
          if (!current) return;
          setState({
            data: snapshot?.products ?? null,
            loading: false,
            error: '',
            storageError: '',
            source: snapshot ? 'cache-pending-sync' : null,
            lastSuccessfulCatalogSyncAt: snapshot?.metadata.lastSuccessfulCatalogSyncAt ?? null,
            unsyncedOfflineOrderCount,
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
          unsyncedOfflineOrderCount: 0,
        }));
      } catch (error) {
        if (!current || controller.signal.aborted) return;
        const networkError = errorMessage(error, 'ไม่สามารถโหลดข้อมูลสินค้าได้');
        try {
          const [snapshot, unsyncedOfflineOrderCount] = await Promise.all([
            readConfirmedCatalogSnapshot(storeId),
            getUnsyncedOfflineOrderCount(storeId),
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
            unsyncedOfflineOrderCount,
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
  }, [isOnline, revision, storeId]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  return {
    ...state,
    isCached: state.source === 'cache-offline' || state.source === 'cache-fallback' || state.source === 'cache-pending-sync',
    offlineUnavailable: !isOnline && !state.loading && state.data === null,
    refresh,
  };
}
