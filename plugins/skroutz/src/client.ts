import type { PluginHttpLogFn, PluginLogger } from '@opensales/plugin-sdk';

import { SKROUTZ_ACCEPT_HEADER } from './config.js';

// ─── Domeniu de autentificare ─────────────────────────────────────────────────
// Skroutz are token-uri separate pentru Orders API și Products API.
export type SkroutzAuthDomain = 'orders' | 'products';

// ─── Error types ───────────────────────────────────────────────────────────────

interface SkroutzErrorEntry {
  code?: string;
  messages?: string[];
}

export class SkroutzApiError extends Error {
  readonly messages: string[];

  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = 'SkroutzApiError';
    this.messages = extractMessages(raw);
  }
}

export class SkroutzRateLimitError extends SkroutzApiError {
  constructor(path: string) {
    super('Skroutz rate limit exceeded (429)', 429, path, null);
    this.name = 'SkroutzRateLimitError';
  }
}

function extractMessages(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object') return [];
  const errors = (raw as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  const out: string[] = [];
  for (const entry of errors as SkroutzErrorEntry[]) {
    if (Array.isArray(entry.messages)) {
      for (const m of entry.messages) {
        if (typeof m === 'string') out.push(m);
      }
    }
  }
  return out;
}

// ─── Client options ─────────────────────────────────────────────────────────────

export interface SkroutzClientOptions {
  ordersToken?: string;
  productsToken?: string;
  baseUrl: string;
  logger: PluginLogger;
  httpLog?: PluginHttpLogFn;
  /** Injectabil pentru teste. Default: global fetch. */
  fetchFn?: typeof fetch;
  /** Timeout per request (ms). Default 30s. */
  timeoutMs?: number;
}

// ─── SkroutzClient ───────────────────────────────────────────────────────────────

export class SkroutzClient {
  private readonly ordersToken: string | undefined;
  private readonly productsToken: string | undefined;
  private readonly baseUrl: string;
  private readonly logger: PluginLogger;
  private readonly httpLog: PluginHttpLogFn | undefined;
  /** Fetch injectat pentru teste; când lipsește, folosim global fetch *late-bound*. */
  private readonly fetchFn: typeof fetch | undefined;
  private readonly timeoutMs: number;

  constructor(opts: SkroutzClientOptions) {
    this.ordersToken = opts.ordersToken;
    this.productsToken = opts.productsToken;
    this.baseUrl = opts.baseUrl;
    this.logger = opts.logger;
    this.httpLog = opts.httpLog;
    this.fetchFn = opts.fetchFn;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private doFetch(url: string, init: RequestInit): Promise<Response> {
    // Late-bind la global fetch ca testele care fac stub/unstub să nu rămână
    // cu o referință veche capturată în constructor.
    return (this.fetchFn ?? fetch)(url, init);
  }

  private tokenFor(domain: SkroutzAuthDomain): string {
    const token = domain === 'orders' ? this.ordersToken : this.productsToken;
    if (!token) {
      throw new Error(
        `Skroutz plugin: missing ${domain === 'orders' ? 'ordersToken' : 'productsToken'}. Configure it via onConfigure.`,
      );
    }
    return token;
  }

  private trace(entry: {
    method: string;
    path: string;
    url: string;
    requestBody?: unknown;
    status?: number;
    responseBody?: unknown;
    durationMs?: number;
    error?: string;
  }): void {
    if (!this.httpLog) return;
    try {
      this.httpLog({
        method: entry.method,
        url: entry.url,
        path: entry.path,
        requestBody: entry.requestBody,
        status: entry.status,
        responseBody: entry.responseBody,
        durationMs: entry.durationMs,
        error: entry.error,
      });
    } catch {
      // logging never breaks the request path
    }
  }

  private async request<T>(
    domain: SkroutzAuthDomain,
    method: string,
    path: string,
    body?: unknown,
    form?: FormData,
  ): Promise<T> {
    const token = this.tokenFor(domain);
    const url = this.baseUrl + path;
    const isForm = form !== undefined;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: SKROUTZ_ACCEPT_HEADER,
    };
    // FormData: lăsăm fetch să seteze Content-Type cu boundary.
    if (!isForm) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }

    this.logger.debug('Skroutz API request', { method, path, domain });
    const start = Date.now();

    let response: Response;
    try {
      response = await this.doFetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(isForm ? { body: form } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      this.trace({
        method,
        path,
        url,
        requestBody: isForm ? '[multipart]' : body,
        durationMs: Date.now() - start,
        error: String(err),
      });
      throw err;
    }

    if (response.status === 429) {
      this.trace({ method, path, url, status: 429, durationMs: Date.now() - start });
      throw new SkroutzRateLimitError(path);
    }

    if (!response.ok) {
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        raw = null;
      }
      this.logger.warn('Skroutz API error', { method, path, status: response.status, raw });
      this.trace({
        method,
        path,
        url,
        requestBody: isForm ? '[multipart]' : body,
        status: response.status,
        responseBody: raw,
        durationMs: Date.now() - start,
      });
      const summary = raw !== null ? ` — ${JSON.stringify(raw).slice(0, 1000)}` : '';
      throw new SkroutzApiError(
        `Skroutz API ${method} ${path} → HTTP ${response.status}${summary}`,
        response.status,
        path,
        raw,
      );
    }

    if (response.status === 204) {
      this.trace({ method, path, url, status: 204, durationMs: Date.now() - start });
      return undefined as T;
    }

    const data = (await response.json()) as T;
    this.trace({
      method,
      path,
      url,
      requestBody: isForm ? '[multipart]' : body,
      status: response.status,
      responseBody: data,
      durationMs: Date.now() - start,
    });
    return data;
  }

  get<T>(domain: SkroutzAuthDomain, path: string): Promise<T> {
    return this.request<T>(domain, 'GET', path);
  }

  post<T>(domain: SkroutzAuthDomain, path: string, body: unknown): Promise<T> {
    return this.request<T>(domain, 'POST', path, body);
  }

  postForm<T>(domain: SkroutzAuthDomain, path: string, form: FormData): Promise<T> {
    return this.request<T>(domain, 'POST', path, undefined, form);
  }
}
