import { apiRequest, postJson } from './client';
import type {
  CancelStockPlanResponse,
  CreateStockPlanRequest,
  CreateStockPlanResponse,
  StockAdjustmentRequest,
  StockAdjustmentResponse,
  HistoricalCorrectionRequest,
  HistoricalCorrectionResponse,
  StockPlan,
  StockReconciliationRequest,
  StockReconciliationResponse,
  StockSummaryResponse,
} from '../types/stock';

export function getStockSummary(date: string, signal?: AbortSignal): Promise<StockSummaryResponse> {
  return apiRequest(`/api/stock/daily-summary?date=${encodeURIComponent(date)}`, { signal });
}

export function adjustStock(payload: StockAdjustmentRequest): Promise<StockAdjustmentResponse> {
  return postJson('/api/stock/adjust', payload);
}

export function correctHistoricalStock(payload: HistoricalCorrectionRequest): Promise<HistoricalCorrectionResponse> {
  return postJson('/api/stock/historical-correction', payload);
}

/** Corrects current stock after an offline sync oversold it. */
export function reconcileStock(payload: StockReconciliationRequest): Promise<StockReconciliationResponse> {
  return postJson('/api/stock/reconcile', payload);
}

export function getStockPlans(signal?: AbortSignal): Promise<StockPlan[]> {
  return apiRequest('/api/stock/plans', { signal });
}

export function createStockPlan(payload: CreateStockPlanRequest): Promise<CreateStockPlanResponse> {
  return postJson('/api/stock/plans', payload);
}

export function cancelStockPlan(id: number): Promise<CancelStockPlanResponse> {
  return apiRequest(`/api/stock/plans/${id}`, { method: 'DELETE' });
}
