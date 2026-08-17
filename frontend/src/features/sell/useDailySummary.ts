import { getDailySummary } from '../../api/reports';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useDailySummary() {
  return useAbortableQuery(getDailySummary, []);
}
