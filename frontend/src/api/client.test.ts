import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, postJson, subscribeToUnauthorized } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

describe('typed API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses same-origin cookies and parses existing JSON shapes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { authenticated: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest<{ authenticated: boolean }>('/api/auth/status')).resolves.toEqual({
      authenticated: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/status',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('normalizes JSON errors and publishes protected 401 responses', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorized(listener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'expired' })));
    const request = apiRequest('/api/products');
    await expect(request).rejects.toMatchObject({ status: 401, message: 'expired' });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('does not publish expected login 401 responses', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorized(listener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid PIN' })));
    await expect(apiRequest('/api/auth/login', { notifyUnauthorized: false })).rejects.toThrow(
      'invalid PIN',
    );
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('sends one JSON mutation request and does not retry failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'failed' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postJson('/api/example', { value: 1 })).rejects.toThrow('failed');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/example',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ value: 1 }) }),
    );
  });
});
