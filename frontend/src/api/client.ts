export interface ApiErrorBody {
  error?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(message: string, status: number, body: ApiErrorBody | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Long enough for a slow mobile connection, short enough to never strand a cashier. */
export const DEFAULT_API_TIMEOUT_MS = 12_000;
/** A queue is waiting: fail fast so the cashier can fall back to a local sale. */
export const CHECKOUT_API_TIMEOUT_MS = 8_000;

export const REQUEST_TIMEOUT_MESSAGE = 'เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่อีกครั้ง';

export class ApiTimeoutError extends Error {
  constructor(message = REQUEST_TIMEOUT_MESSAGE) {
    super(message);
    this.name = 'ApiTimeoutError';
  }
}

export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiTimeoutError || error instanceof TypeError;
}

type UnauthorizedListener = () => void;
type ReachabilityListener = (reachable: boolean) => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();
const reachabilityListeners = new Set<ReachabilityListener>();

export function subscribeToUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function publishUnauthorized(): void {
  unauthorizedListeners.forEach((listener) => listener());
}

/**
 * Every request is free evidence about whether the backend is answering, so
 * reachability is derived from ordinary traffic instead of extra polling.
 */
export function subscribeToBackendReachability(listener: ReachabilityListener): () => void {
  reachabilityListeners.add(listener);
  return () => reachabilityListeners.delete(listener);
}

export function publishBackendReachability(reachable: boolean): void {
  reachabilityListeners.forEach((listener) => listener(reachable));
}

export interface ApiRequestOptions extends RequestInit {
  notifyUnauthorized?: boolean;
  /** Milliseconds before the request is aborted. Pass `0` to opt out. */
  timeoutMs?: number;
}

interface TimedRequest {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

/**
 * Derives a signal that aborts on either the caller's signal or the timeout, so
 * existing `AbortController` handling upstream keeps working untouched.
 */
function startTimedRequest(callerSignal: AbortSignal | null | undefined, timeoutMs: number): TimedRequest {
  const controller = new AbortController();
  let expired = false;

  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timer = timeoutMs > 0
    ? setTimeout(() => { expired = true; controller.abort(); }, timeoutMs)
    : undefined;

  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

/**
 * Translates a transport failure into a timeout error when we caused the abort,
 * and reports reachability. A caller-initiated abort is left alone: it says
 * nothing about the server.
 */
function handleTransportFailure(
  error: unknown,
  request: TimedRequest,
  callerSignal: AbortSignal | null | undefined,
): never {
  if (request.timedOut()) {
    publishBackendReachability(false);
    throw new ApiTimeoutError();
  }
  if (!callerSignal?.aborted) publishBackendReachability(false);
  throw error;
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  return response.json();
}

export async function apiRequest<T>(
  path: string,
  { notifyUnauthorized = true, headers, timeoutMs = DEFAULT_API_TIMEOUT_MS, signal, ...init }: ApiRequestOptions = {},
): Promise<T> {
  const request = startTimedRequest(signal, timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: request.signal,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    });
  } catch (error) {
    handleTransportFailure(error, request, signal);
  } finally {
    request.dispose();
  }

  publishBackendReachability(true);
  const body = await parseJson(response);

  if (!response.ok) {
    const errorBody = body && typeof body === 'object' ? (body as ApiErrorBody) : null;
    if (response.status === 401 && notifyUnauthorized) publishUnauthorized();
    throw new ApiError(
      errorBody?.error || `Request failed with status ${response.status}`,
      response.status,
      errorBody,
    );
  }

  return body as T;
}

export async function apiBlobRequest(
  path: string,
  { notifyUnauthorized = true, headers, timeoutMs = DEFAULT_API_TIMEOUT_MS, signal, ...init }: ApiRequestOptions = {},
): Promise<Blob> {
  const request = startTimedRequest(signal, timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: request.signal,
      credentials: 'same-origin',
      headers: { Accept: 'image/png', ...headers },
    });
  } catch (error) {
    handleTransportFailure(error, request, signal);
  } finally {
    request.dispose();
  }

  publishBackendReachability(true);
  if (!response.ok) {
    const body = await parseJson(response);
    const errorBody = body && typeof body === 'object' ? (body as ApiErrorBody) : null;
    if (response.status === 401 && notifyUnauthorized) publishUnauthorized();
    throw new ApiError(
      errorBody?.error || `Request failed with status ${response.status}`,
      response.status,
      errorBody,
    );
  }

  return response.blob();
}

export function postJson<TResponse, TBody>(
  path: string,
  body: TBody,
  options: ApiRequestOptions = {},
): Promise<TResponse> {
  return apiRequest<TResponse>(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  });
}
