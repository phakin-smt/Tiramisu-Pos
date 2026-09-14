import { apiRequest } from './client';
import type { AnalyticsRange, AnalyticsResponse } from '../types/analytics';

export function getAnalytics(range: AnalyticsRange, signal?: AbortSignal): Promise<AnalyticsResponse> {
  const query = typeof range === 'number'
    ? `days=${range}`
    : `start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
  return apiRequest(`/api/analytics?${query}`, { signal });
}
