import { ApiError, type ApiErrorBody } from './api-types.js';

export interface ApiClientOptions {
  baseUrl: string;
  getAuthToken?: () => string | null | Promise<string | null>;
  fetchFn?: typeof fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { baseUrl, fetchFn = fetch, getAuthToken } = this.opts;
    // Use direct concatenation instead of new URL(path, baseUrl) — when path
    // starts with '/', the URL constructor drops any baseUrl suffix (e.g. '/rpc').
    const url = new URL(baseUrl.replace(/\/$/, '') + path);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type') && options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', 'application/json');
    if (getAuthToken) {
      const token = await getAuthToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    const method = options.method ?? 'GET';
    if (method !== 'GET' && typeof document !== 'undefined') {
      const { readCsrfToken } = await import('./csrf.js');
      const csrf = readCsrfToken();
      if (csrf) headers.set('X-CSRF-Token', csrf);
    }

    const bodyPayload = options.body !== undefined ? { body: JSON.stringify(options.body) } : {};
    const signalPayload = options.signal !== undefined ? { signal: options.signal } : {};
    const res = await fetchFn(url.toString(), {
      method,
      headers,
      cache: 'no-store',
      credentials: 'include',
      ...bodyPayload,
      ...signalPayload,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;

    if (!res.ok) {
      const body = (parsed as ApiErrorBody | null) ?? {
        error: { code: 'UNKNOWN', message: `HTTP ${res.status}` },
      };
      throw new ApiError(res.status, body);
    }

    return parsed as T;
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  put<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * POST with a FormData body (multipart/form-data).
   * Does NOT set Content-Type — the browser adds it automatically with the correct boundary.
   */
  async postForm<T>(path: string, form: FormData): Promise<T> {
    const { baseUrl, fetchFn = fetch, getAuthToken } = this.opts;
    const url = new URL(baseUrl.replace(/\/$/, '') + path);
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (getAuthToken) {
      const token = await getAuthToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    if (typeof document !== 'undefined') {
      const { readCsrfToken } = await import('./csrf.js');
      const csrf = readCsrfToken();
      if (csrf) headers.set('X-CSRF-Token', csrf);
    }
    const res = await fetchFn(url.toString(), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const body = (parsed as ApiErrorBody | null) ?? {
        error: { code: 'UNKNOWN', message: `HTTP ${res.status}` },
      };
      throw new ApiError(res.status, body);
    }
    return parsed as T;
  }
}

let singleton: ApiClient | null = null;

export function getApiClient(): ApiClient {
  if (singleton) return singleton;
  let baseUrl: string;
  if (typeof window !== 'undefined') {
    // Browser: same-origin /rpc — proxied by app/rpc/[...path]/route.ts at runtime.
    baseUrl = `${window.location.origin}/rpc`;
  } else {
    // Server (RSC, route handlers, server actions): hit the API directly.
    // No proxy hop, and avoids the "absolute URL required" error since
    // we're outside a request context that knows the public origin.
    const apiUrl = process.env.API_URL;
    if (!apiUrl) {
      throw new Error(
        'API_URL is required server-side. Set on the web service, ' +
          'e.g. on Railway: API_URL=https://${{ @opensales/api.RAILWAY_PUBLIC_DOMAIN }}',
      );
    }
    baseUrl = apiUrl.replace(/\/$/, '');
  }
  singleton = new ApiClient({ baseUrl });
  return singleton;
}
