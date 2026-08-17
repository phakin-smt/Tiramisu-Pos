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

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

export function subscribeToUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function publishUnauthorized(): void {
  unauthorizedListeners.forEach((listener) => listener());
}

export interface ApiRequestOptions extends RequestInit {
  notifyUnauthorized?: boolean;
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  return response.json();
}

export async function apiRequest<T>(
  path: string,
  { notifyUnauthorized = true, headers, ...init }: ApiRequestOptions = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  });
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
