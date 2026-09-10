import { apiBlobRequest, CHECKOUT_API_TIMEOUT_MS, postJson } from './client';
import type { CreateOrderRequest, CreateOrderResponse } from '../types/checkout';

export function createOrder(payload: CreateOrderRequest, idempotencyKey: string): Promise<CreateOrderResponse> {
  return postJson('/api/orders', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
    timeoutMs: CHECKOUT_API_TIMEOUT_MS,
  });
}

export interface PaymentQr {
  blob: Blob;
  /**
   * False when the shop is paid through a picture of its own QR, which cannot
   * hold a total. The server says so in a header, because the bytes cannot.
   */
  amountInQr: boolean;
}

export async function getPaymentQr(amount: number, signal?: AbortSignal): Promise<PaymentQr> {
  let amountInQr = true;
  const blob = await apiBlobRequest(`/api/payment-qr?amount=${encodeURIComponent(amount.toFixed(2))}`, {
    signal,
    cache: 'no-store',
    // A server that predates per-store QR sends no header and only ever
    // generated a code with the amount inside, so the default stands.
    onHeaders: (headers) => { amountInQr = headers.get('X-Payment-QR-Amount') !== 'manual'; },
  });
  return { blob, amountInQr };
}
