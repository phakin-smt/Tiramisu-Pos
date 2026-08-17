import { useMemo } from 'react';
import { getStockSummary } from '../../api/stock';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useStockSummary(date: string) {
  const request = useMemo(() => (signal: AbortSignal) => getStockSummary(date, signal), [date]);
  return useAbortableQuery(request, [request]);
}
