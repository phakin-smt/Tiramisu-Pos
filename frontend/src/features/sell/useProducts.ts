import { useCallback, useEffect, useState } from 'react';

import { getProducts } from '../../api/products';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { readConfirmedCatalogSnapshot, replaceConfirmedCatalogSnapshot } from '../../offline/catalogSnapshot';
import type { CatalogProduct } from '../../types/products';

export type CatalogDataSource = 'server' | 'cache-offline' | 'cache-fallback';

interface ProductsState {
  data: CatalogProduct[] | null;
  loading: boolean;
  error: string;
  storageError: string;
  source: CatalogDataSource | null;
  lastSuccessfulCatalogSyncAt: string | null;
}

const initialState: ProductsState = {
  data: null,
  loading: true,
  error: '',
  storageError: '',
  source: null,
  lastSuccessfulCatalogSyncAt: null,
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
          const snapshot = await readConfirmedCatalogSnapshot();
          if (!current) return;
          setState({
            data: snapshot?.products ?? null,
            loading: false,
            error: '',
            storageError: '',
            source: snapshot ? 'cache-offline' : null,
            lastSuccessfulCatalogSyncAt: snapshot?.metadata.lastSuccessfulCatalogSyncAt ?? null,
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
          });
        }
        return;
      }

      try {
        const products = await getProducts(controller.signal);
        if (!current) return;

        setState((previous) => ({
          data: products,
          loading: false,
          error: '',
          storageError: '',
          source: 'server',
          lastSuccessfulCatalogSyncAt: previous.lastSuccessfulCatalogSyncAt,
        }));

        try {
          const metadata = await replaceConfirmedCatalogSnapshot(products);
          if (!current) return;
          setState((previous) => ({
            ...previous,
            lastSuccessfulCatalogSyncAt: metadata.lastSuccessfulCatalogSyncAt,
          }));
        } catch (error) {
          if (!current) return;
          setState((previous) => ({
            ...previous,
            storageError: errorMessage(error, 'ไม่สามารถบันทึกข้อมูลสินค้าออฟไลน์ได้'),
          }));
        }
      } catch (error) {
        if (!current || controller.signal.aborted) return;
        const networkError = errorMessage(error, 'ไม่สามารถโหลดข้อมูลสินค้าได้');
        try {
          const snapshot = await readConfirmedCatalogSnapshot();
          if (!current) return;
          setState((previous) => ({
            data: snapshot?.products ?? previous.data,
            loading: false,
            error: networkError,
            storageError: '',
            source: snapshot ? 'cache-fallback' : previous.source,
            lastSuccessfulCatalogSyncAt: snapshot?.metadata.lastSuccessfulCatalogSyncAt
              ?? previous.lastSuccessfulCatalogSyncAt,
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
    isCached: state.source === 'cache-offline' || state.source === 'cache-fallback',
    offlineUnavailable: !isOnline && !state.loading && state.data === null,
    refresh,
  };
}
