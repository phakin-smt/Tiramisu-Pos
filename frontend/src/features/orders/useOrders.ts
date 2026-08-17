import { useMemo } from 'react';
import { getOrders } from '../../api/orders';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useOrders(date: string, revision = 0) {
  const request = useMemo(() => (signal: AbortSignal) => getOrders(date, signal), [date, revision]);
  return useAbortableQuery(request, [request]);
}
