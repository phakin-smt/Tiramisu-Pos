import { apiRequest } from './client';
import type { StockSummaryResponse } from '../types/stock';

export function getStockSummary(date: string, signal?: AbortSignal): Promise<StockSummaryResponse> {
  return apiRequest(`/api/stock/daily-summary?date=${encodeURIComponent(date)}`, { signal });
}
