import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { publishBackendReachability } from '../api/client';
import { ConnectivityProvider, useConnectivity } from './ConnectivityContext';

function ConnectivityReadout() {
  const { isOnline, isBackendReachable, isBackendOnline } = useConnectivity();
  return (
    <output>
      {[
        `interface:${isOnline ? 'up' : 'down'}`,
        `backend:${isBackendReachable ? 'up' : 'down'}`,
        `authoritative:${isBackendOnline ? 'up' : 'down'}`,
      ].join(' ')}
    </output>
  );
}

function readout() { return screen.getByRole('status').textContent; }

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

function renderConnectivity() {
  return render(<ConnectivityProvider><ConnectivityReadout /></ConnectivityProvider>);
}

afterEach(() => {
  cleanup();
  setNavigatorOnline(true);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('backend reachability', () => {
  it('starts optimistic so a fresh session never declares the server down', () => {
    setNavigatorOnline(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderConnectivity();

    expect(readout()).toBe('interface:up backend:up authoritative:up');
    // No probe on mount: healthy sessions spend zero extra requests.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('separates a live interface from an unreachable backend', () => {
    setNavigatorOnline(true);
    vi.stubGlobal('fetch', vi.fn());
    renderConnectivity();

    act(() => publishBackendReachability(false));
    expect(readout()).toBe('interface:up backend:down authoritative:down');

    act(() => publishBackendReachability(true));
    expect(readout()).toBe('interface:up backend:up authoritative:up');
  });

  it('reports the interface down without blaming the backend', () => {
    setNavigatorOnline(true);
    vi.stubGlobal('fetch', vi.fn());
    renderConnectivity();

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(readout()).toBe('interface:down backend:up authoritative:down');
  });

  it('probes the health endpoint when the interface comes back', async () => {
    setNavigatorOnline(false);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    renderConnectivity();

    await act(async () => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));
    expect(readout()).toBe('interface:up backend:up authoritative:up');
  });

  it('keeps the backend marked down when the recovery probe fails', async () => {
    setNavigatorOnline(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderConnectivity();

    await act(async () => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(readout()).toBe('interface:up backend:down authoritative:down');
  });

  it('treats any HTTP answer as reachable, including an error status', async () => {
    setNavigatorOnline(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response));
    renderConnectivity();

    act(() => publishBackendReachability(false));
    await act(async () => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(readout()).toBe('interface:up backend:up authoritative:up');
  });

  it('does not poll while the backend is healthy', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setNavigatorOnline(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    renderConnectivity();

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries on a slow interval only while the backend is unreachable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setNavigatorOnline(true);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    renderConnectivity();

    act(() => publishBackendReachability(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Recovery stops the polling.
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not probe while the interface itself is down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setNavigatorOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderConnectivity();

    act(() => publishBackendReachability(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes a live snapshot that does not go stale between renders', () => {
    setNavigatorOnline(true);
    vi.stubGlobal('fetch', vi.fn());
    let snapshot: (() => { isBackendOnline: boolean }) | null = null;
    function Capture() {
      snapshot = useConnectivity().getSnapshot;
      return null;
    }
    render(<ConnectivityProvider><Capture /></ConnectivityProvider>);

    expect(snapshot!().isBackendOnline).toBe(true);
    // No re-render happens here, yet the snapshot must already see the change.
    setNavigatorOnline(false);
    expect(snapshot!().isBackendOnline).toBe(false);
  });
});
