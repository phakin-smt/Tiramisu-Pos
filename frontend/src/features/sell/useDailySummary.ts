import { useCallback, useEffect, useState } from 'react';

import { getDailySummary } from '../../api/reports';
import type { DailySummaryResponse } from '../../types/reports';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useDailySummary() {
  const [revision, setRevision] = useState(0);
  const query = useAbortableQuery(getDailySummary, [revision]);
  const [confirmedSummary, setConfirmedSummary] = useState<DailySummaryResponse | null>(null);
  useEffect(() => { if (query.data) setConfirmedSummary(query.data); }, [query.data]);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  return { ...query, data: query.data ?? confirmedSummary, refresh };
}
