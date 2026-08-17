import { apiBlobRequest, postJson } from './client';
import type { CreateOrderRequest, CreateOrderResponse } from '../types/checkout';

export function createOrder(payload: CreateOrderRequest, idempotencyKey: string): Promise<CreateOrderResponse> {
  return postJson('/api/orders', payload, { headers: { 'Idempotency-Key': idempotencyKey } });
}

export function getPaymentQr(amount: number, signal?: AbortSignal): Promise<Blob> {
  return apiBlobRequest(`/api/payment-qr?amount=${encodeURIComponent(amount.toFixed(2))}`, {
    signal,
    cache: 'no-store',
  });
}
