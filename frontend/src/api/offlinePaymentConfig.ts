import { apiRequest } from './client';

/**
 * How this shop takes a transfer.
 *
 * `promptpay` is the generated code, which carries the amount. `image` is a
 * picture the shop uploaded, which cannot -- the till has to put the total in
 * front of the customer itself. `mode` is absent from a server that predates
 * per-store QR; such a server only ever answered with a receiver.
 */
export type PaymentMode = 'promptpay' | 'image' | 'none';

export interface OfflinePaymentConfigResponse {
  configured: boolean;
  mode?: PaymentMode;
  merchantAccountInfo?: string;
  imageUrl?: string;
  imageChecksum?: string;
  version: number;
}

export function getOfflinePaymentConfig(signal?: AbortSignal): Promise<OfflinePaymentConfigResponse> {
  return apiRequest('/api/offline-payment-config', {
    signal,
    cache: 'no-store',
    notifyUnauthorized: false,
  });
}
