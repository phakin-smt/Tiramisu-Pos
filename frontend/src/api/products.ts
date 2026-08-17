import { apiRequest, postJson } from './client';
import type { CatalogProduct, DeleteProductResponse, ProductActiveResponse, ProductMutationResponse, ProductPayload } from '../types/products';

export function getProducts(signal?: AbortSignal): Promise<CatalogProduct[]> {
  return apiRequest('/api/products', { signal });
}

export function createProduct(payload: ProductPayload): Promise<ProductMutationResponse> {
  return postJson('/api/products', payload);
}

export function updateProduct(id: number, payload: ProductPayload): Promise<ProductMutationResponse> {
  return apiRequest(`/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function setProductActive(id: number, active: boolean): Promise<ProductActiveResponse> {
  return apiRequest(`/api/products/${id}/active`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  });
}

export function deleteProduct(id: number): Promise<DeleteProductResponse> {
  return apiRequest(`/api/products/${id}`, { method: 'DELETE' });
}
