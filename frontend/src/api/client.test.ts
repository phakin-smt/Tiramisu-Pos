import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiTimeoutError,
  apiRequest,
  postJson,
  REQUEST_TIMEOUT_MESSAGE,
  subscribeToBackendReachability,
  subscribeToUnauthorized,
} from './client';

/** Settles only on abort, the way a real request into dead air behaves. */
function neverResponds(init: RequestInit = {}) {
  const abortError = () => new DOMException('Aborted', 'AbortError');
  if (init.signal?.aborted) return Promise.reject(abortError());
  return new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(abortError()));
  });
}

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

describe('API request timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('aborts a request that never answers and reports it as a timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => neverResponds(init));
    vi.stubGlobal('fetch', fetchMock);

    const request = apiRequest('/api/products', { timeoutMs: 5_000 });
    const failure = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);

    const error = await failure;
    expect(error).toBeInstanceOf(ApiTimeoutError);
    expect((error as Error).message).toBe(REQUEST_TIMEOUT_MESSAGE);
  });

  it('does not fire the timeout before it is due', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => neverResponds(init)));

    const settled = vi.fn();
    void apiRequest('/api/products', { timeoutMs: 8_000 }).catch(settled);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('sends the request exactly once and never retries after a timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => neverResponds(init));
    vi.stubGlobal('fetch', fetchMock);

    const request = postJson('/api/orders', { items: [] }, { timeoutMs: 4_000 });
    const assertion = expect(request).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(4_000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('publishes the backend as unreachable on timeout and reachable on any response', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToBackendReachability(listener);
    try {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => neverResponds(init)));
      const request = apiRequest('/api/products', { timeoutMs: 2_000 });
      const assertion = expect(request).rejects.toBeInstanceOf(ApiTimeoutError);
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;
      expect(listener).toHaveBeenLastCalledWith(false);

      vi.useRealTimers();
      // Even a server error proves the backend answered.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' })));
      await expect(apiRequest('/api/products')).rejects.toThrow('boom');
      expect(listener).toHaveBeenLastCalledWith(true);
    } finally {
      unsubscribe();
    }
  });

  it('reports a transport failure as unreachable without calling it a timeout', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToBackendReachability(listener);
    try {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      await expect(apiRequest('/api/products')).rejects.toBeInstanceOf(TypeError);
      expect(listener).toHaveBeenLastCalledWith(false);
    } finally {
      unsubscribe();
    }
  });

  it('still honours a caller AbortSignal and does not blame the server for it', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToBackendReachability(listener);
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => neverResponds(init)));
      const controller = new AbortController();
      const request = apiRequest('/api/products', { signal: controller.signal });
      controller.abort();

      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => neverResponds(init)));
    const controller = new AbortController();
    controller.abort();
    await expect(apiRequest('/api/products', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('opts out of the timeout when asked', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/health', { timeoutMs: 0 })).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
