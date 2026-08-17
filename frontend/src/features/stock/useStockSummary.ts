import { useMemo } from 'react';
import { getStockSummary } from '../../api/stock';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useStockSummary(date: string, revision = 0) {
  const request = useMemo(() => (signal: AbortSignal) => getStockSummary(date, signal), [date, revision]);
  return useAbortableQuery(request, [request]);
}
