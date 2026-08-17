import { useMemo } from 'react';
import { getStockPlans } from '../../api/stock';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useStockPlans(revision = 0) {
  const request = useMemo(() => (signal: AbortSignal) => getStockPlans(signal), [revision]);
  return useAbortableQuery(request, [request]);
}
