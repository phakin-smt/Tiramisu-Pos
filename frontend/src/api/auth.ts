import { apiRequest, postJson } from './client';

export interface AuthStatusResponse {
  authenticated: boolean;
  configured: boolean;
}

export interface LoginRequest {
  pin: string;
}

export function getAuthStatus(): Promise<AuthStatusResponse> {
  return apiRequest<AuthStatusResponse>('/api/auth/status', { notifyUnauthorized: false });
}

export function loginWithPin(pin: string): Promise<AuthStatusResponse> {
  return postJson<AuthStatusResponse, LoginRequest>(
    '/api/auth/login',
    { pin },
    { notifyUnauthorized: false },
  );
}

export function logoutSession(): Promise<AuthStatusResponse> {
  return apiRequest<AuthStatusResponse>('/api/auth/logout', {
    method: 'POST',
    notifyUnauthorized: false,
  });
}
