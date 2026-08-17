import { apiRequest } from './client';
import type { AnalyticsRange, AnalyticsResponse } from '../types/analytics';

export function getAnalytics(days: AnalyticsRange, signal?: AbortSignal): Promise<AnalyticsResponse> {
  return apiRequest(`/api/analytics?days=${days}`, { signal });
}
