import { apiBlobRequest, apiRequest } from './client';

export interface StorePaymentQrResponse {
  storeId: number;
  imageUrl: string | null;
  byteSize?: number;
}

/** `image` is the data URI produced by prepareQrForUpload. */
export function setStorePaymentQr(image: string): Promise<StorePaymentQrResponse> {
  return apiRequest('/api/store/payment-qr', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image }),
  });
}

export function deleteStorePaymentQr(): Promise<StorePaymentQrResponse> {
  return apiRequest('/api/store/payment-qr', { method: 'DELETE' });
}

/**
 * The shop's QR as bytes, for keeping on a till that has to sell offline.
 *
 * The address carries the checksum of the picture it names, so this is safe to
 * let the browser cache: a replaced QR is a different URL.
 */
export function getStorePaymentQrBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  return apiBlobRequest(url, { signal });
}
