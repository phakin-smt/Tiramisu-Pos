import { getCloseDayReport, getReportDays } from '../../api/reports';
import { useAbortableQuery } from '../shared/useAbortableQuery';

export function useReportDays() {
  return useAbortableQuery((signal) => getReportDays(signal), []);
}

export function useReportDetail(date: string | null) {
  return useAbortableQuery(
    date ? (signal) => getCloseDayReport(date, signal) : null,
    [date],
  );
}
