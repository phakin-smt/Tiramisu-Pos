import { apiRequest } from './client';
import type { CloseDayReport, ReportDaysResponse } from '../types/reports';

export function getReportDays(signal?: AbortSignal): Promise<ReportDaysResponse> {
  return apiRequest('/api/reports/days', { signal });
}

export function getCloseDayReport(date: string, signal?: AbortSignal): Promise<CloseDayReport> {
  return apiRequest(`/api/reports/close-day?date=${encodeURIComponent(date)}`, { signal });
}
