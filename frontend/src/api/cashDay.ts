import { apiRequest } from './client';
import type { DenominationCounts } from '../domain/openingFloat';
import type { CashDayResponse } from '../types/cashDay';

export function getCashDay(signal?: AbortSignal): Promise<CashDayResponse> {
  return apiRequest('/api/cash-day', { signal });
}

export function saveCashDay(openingFloat: number, denominations: DenominationCounts | null = null): Promise<CashDayResponse> {
  return apiRequest('/api/cash-day', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(denominations ? { openingFloat, denominations } : { openingFloat }),
  });
}
