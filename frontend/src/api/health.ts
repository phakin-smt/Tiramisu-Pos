/** A probe should never make the cashier wait; the backend answers in milliseconds or not at all. */
export const HEALTH_PROBE_TIMEOUT_MS = 4_000;

/**
 * Answers only "did the Baannoi POS backend respond at all?".
 *
 * Any HTTP status counts as reachable — a 401 or a 503 still proves the server
 * answered. Only a transport failure or a timeout means the backend is gone,
 * which is the distinction `navigator.onLine` cannot make.
 */
export async function probeBackendReachable(signal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) return false;
    signal.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);

  try {
    await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
