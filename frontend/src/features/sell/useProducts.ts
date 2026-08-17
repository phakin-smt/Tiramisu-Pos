import { useCallback, useEffect, useState } from 'react';

import { getProducts } from '../../api/products';
import type { CatalogProduct } from '../../types/products';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useProducts() {
  const [revision, setRevision] = useState(0);
  const query = useAbortableQuery(getProducts, [revision]);
  const [confirmedProducts, setConfirmedProducts] = useState<CatalogProduct[] | null>(null);
  useEffect(() => {
    if (query.data) setConfirmedProducts(query.data);
  }, [query.data]);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  return { ...query, data: query.data ?? confirmedProducts, refresh };
}
