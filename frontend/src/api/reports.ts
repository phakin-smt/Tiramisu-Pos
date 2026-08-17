import { apiRequest } from './client';
import type { CloseDayClosure, CloseDayReport, DailySummaryResponse, ReportDaysResponse } from '../types/reports';

export function getDailySummary(signal?: AbortSignal): Promise<DailySummaryResponse> {
  return apiRequest('/api/reports/daily-summary', { signal });
}

export function getReportDays(signal?: AbortSignal): Promise<ReportDaysResponse> {
  return apiRequest('/api/reports/days', { signal });
}

export function getCloseDayReport(date: string, signal?: AbortSignal): Promise<CloseDayReport> {
  return apiRequest(`/api/reports/close-day?date=${encodeURIComponent(date)}`, { signal });
}

export function getCurrentCloseDayReport(signal?: AbortSignal): Promise<CloseDayReport> {
  return apiRequest('/api/reports/close-day', { signal });
}

export function closeCurrentDay(): Promise<CloseDayClosure> {
  return apiRequest('/api/reports/close-day', { method: 'POST' });
}
