import { apiRequest } from './client';
import type { CancelOrderResponse, OrdersResponse } from '../types/orders';

export function getOrders(date: string, signal?: AbortSignal): Promise<OrdersResponse> {
  return apiRequest(`/api/orders?date=${encodeURIComponent(date)}`, { signal });
}

export function cancelOrder(id: number): Promise<CancelOrderResponse> {
  return apiRequest(`/api/orders/${id}/cancel`, { method: 'POST' });
}
