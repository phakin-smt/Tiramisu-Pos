import { useMemo } from 'react';
import { getAnalytics } from '../../api/analytics';
import type { AnalyticsRange } from '../../types/analytics';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useAnalytics(range: AnalyticsRange) {
  const request = useMemo(() => (signal: AbortSignal) => getAnalytics(range, signal), [range]);
  return useAbortableQuery(request, [request]);
}
