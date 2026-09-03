import { apiRequest, postJson } from './client';
import type { PricingRules } from '../domain/promotion';

export interface Store {
  id: number;
  code: string;
  name: string;
  /** The shop's own mark, or null to fall back to its initials. */
  logoUrl: string | null;
}

export interface StoresResponse {
  stores: Store[];
  /** The store the session is working on, or null when one has to be chosen. */
  storeId: number | null;
}

export interface PricingRulesResponse extends PricingRules {
  storeId: number;
}

export function getStores(signal?: AbortSignal): Promise<StoresResponse> {
  return apiRequest<StoresResponse>('/api/stores', { signal, cache: 'no-store' });
}

export function selectStore(storeId: number): Promise<{ storeId: number }> {
  return postJson<{ storeId: number }, { storeId: number }>('/api/auth/select-store', { storeId });
}

export function getPricingRules(signal?: AbortSignal): Promise<PricingRulesResponse> {
  return apiRequest<PricingRulesResponse>('/api/pricing-rules', { signal, cache: 'no-store' });
}
