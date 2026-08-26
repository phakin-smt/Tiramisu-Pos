import { apiRequest } from './client';

export interface OfflinePaymentConfigResponse {
  configured: boolean;
  merchantAccountInfo?: string;
  version: number;
}

export function getOfflinePaymentConfig(signal?: AbortSignal): Promise<OfflinePaymentConfigResponse> {
  return apiRequest('/api/offline-payment-config', {
    signal,
    cache: 'no-store',
    notifyUnauthorized: false,
  });
}
