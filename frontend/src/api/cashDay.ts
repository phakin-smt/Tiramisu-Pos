import { apiRequest } from './client';
import type { CashDayResponse } from '../types/cashDay';

export function getCashDay(signal?: AbortSignal): Promise<CashDayResponse> {
  return apiRequest('/api/cash-day', { signal });
}

export function saveCashDay(openingFloat: number): Promise<CashDayResponse> {
  return apiRequest('/api/cash-day', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openingFloat }),
  });
}
