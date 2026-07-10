import { Buffer } from 'node:buffer';

import type { PluginHttpLogFn, PluginLogger } from '@opensales/plugin-sdk';

// ─── Error types ─────────────────────────────────────────────────────────────

export class TrendyolApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = 'TrendyolApiError';
  }
}

export class TrendyolRateLimitError extends TrendyolApiError {
  constructor(path: string) {
    super('Trendyol rate limit exceeded (429)', 429, path, null);
    this.name = 'TrendyolRateLimitError';
  }
}

// ─── Rate limiter — 1 000 req/min (conservative: ~16 req/s) ─────────────────

class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;

  constructor(ratePerMinute: number) {
    this.maxTokens = ratePerMinute;
    this.tokens = ratePerMinute;
    this.lastRefill = Date.now();
    // Refill 1 token every (60_000 / ratePerMinute) ms
    this.refillIntervalMs = 60_000 / ratePerMinute;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = Math.floor(elapsed / this.refillIntervalMs);
    if (newTokens > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
      this.lastRefill = now;
    }
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    const waitMs = this.refillIntervalMs - (Date.now() - this.lastRefill);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
    return this.acquire();
  }
}

// ─── Client options ───────────────────────────────────────────────────────────

export interface TrendyolClientOptions {
  sellerId: string;
  apiKey: string;
  apiSecretKey: string;
  storeFrontCode: string;
  userAgent: string;
  baseUrl: string;
  logger: PluginLogger;
  httpLog?: PluginHttpLogFn;
}

// ─── TrendyolClient ───────────────────────────────────────────────────────────

export class TrendyolClient {
  readonly sellerId: string;
  private readonly authHeader: string;
  private readonly storeFrontCode: string;
  private readonly userAgent: string;
  private readonly baseUrl: string;
  private readonly logger: PluginLogger;
  private readonly httpLog: PluginHttpLogFn | undefined;
  /** General rate limiter — 1 000 req/min (most services) */
  private readonly rateLimiter = new RateLimiter(1_000);
  /** Slow rate limiter — 50 req/min (brands, categories) */
  private readonly slowLimiter = new RateLimiter(50);

  constructor(opts: TrendyolClientOptions) {
    this.sellerId = opts.sellerId;
    this.storeFrontCode = opts.storeFrontCode;
    this.userAgent = opts.userAgent;
    this.baseUrl = opts.baseUrl;
    this.logger = opts.logger;
    this.httpLog = opts.httpLog;
    // Basic Auth: base64(apiKey:apiSecretKey)
    this.authHeader =
      'Basic ' + Buffer.from(`${opts.apiKey}:${opts.apiSecretKey}`).toString('base64');
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

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: this.authHeader,
      'User-Agent': this.userAgent,
      storeFrontCode: this.storeFrontCode,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extra,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown, slow = false): Promise<T> {
    await (slow ? this.slowLimiter : this.rateLimiter).acquire();

    const url = this.baseUrl + path;
    this.logger.debug('Trendyol API request', { method, path });
    const start = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(30_000),
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch (err) {
      this.trace({
        method,
        path,
        url,
        requestBody: body,
        durationMs: Date.now() - start,
        error: String(err),
      });
      throw err;
    }

    if (response.status === 429) {
      this.trace({
        method,
        path,
        url,
        requestBody: body,
        status: 429,
        durationMs: Date.now() - start,
      });
      throw new TrendyolRateLimitError(path);
    }

    if (!response.ok) {
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        raw = null;
      }
      this.logger.warn('Trendyol API error', { method, path, status: response.status, raw });
      this.trace({
        method,
        path,
        url,
        requestBody: body,
        status: response.status,
        responseBody: raw,
        durationMs: Date.now() - start,
      });
      const rawSummary = raw !== null ? ` — ${JSON.stringify(raw).slice(0, 1000)}` : '';
      throw new TrendyolApiError(
        `Trendyol API ${method} ${path} → HTTP ${response.status}${rawSummary}`,
        response.status,
        path,
        raw,
      );
    }

    // 204 No Content
    if (response.status === 204) {
      this.trace({
        method,
        path,
        url,
        requestBody: body,
        status: 204,
        durationMs: Date.now() - start,
      });
      return undefined as T;
    }

    const data = (await response.json()) as T;
    this.trace({
      method,
      path,
      url,
      requestBody: body,
      status: response.status,
      responseBody: data,
      durationMs: Date.now() - start,
    });
    return data;
  }

  get<T>(path: string, slow = false): Promise<T> {
    return this.request<T>('GET', path, undefined, slow);
  }

  /** Descarcă răspuns binar (ex. PDF AWB). Returnează bytes + Content-Type. */
  async getRaw(path: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    await this.rateLimiter.acquire();
    const url = this.baseUrl + path;
    const start = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { ...this.buildHeaders(), Accept: 'application/pdf, */*' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.trace({ method: 'GET', path, url, durationMs: Date.now() - start, error: String(err) });
      throw err;
    }
    if (!response.ok) {
      this.trace({
        method: 'GET',
        path,
        url,
        status: response.status,
        durationMs: Date.now() - start,
      });
      throw new TrendyolApiError(
        `Trendyol API GET ${path} → HTTP ${response.status}`,
        response.status,
        path,
        null,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type');
    this.trace({
      method: 'GET',
      path,
      url,
      status: response.status,
      durationMs: Date.now() - start,
    });
    return { bytes, contentType };
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** POST multipart/form-data (ex. respingere claim cu fotografie atașată). */
  async postMultipart<T>(path: string, form: FormData): Promise<T> {
    await this.rateLimiter.acquire();
    const url = this.baseUrl + path;
    const start = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'User-Agent': this.userAgent,
          storeFrontCode: this.storeFrontCode,
          Accept: 'application/json',
        },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.trace({ method: 'POST', path, url, durationMs: Date.now() - start, error: String(err) });
      throw err;
    }

    if (!response.ok) {
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        raw = null;
      }
      this.trace({
        method: 'POST',
        path,
        url,
        status: response.status,
        responseBody: raw,
        durationMs: Date.now() - start,
      });
      const rawSummary = raw !== null ? ` — ${JSON.stringify(raw).slice(0, 1000)}` : '';
      throw new TrendyolApiError(
        `Trendyol API POST ${path} → HTTP ${response.status}${rawSummary}`,
        response.status,
        path,
        raw,
      );
    }

    if (response.status === 204) {
      this.trace({ method: 'POST', path, url, status: 204, durationMs: Date.now() - start });
      return undefined as T;
    }

    const data = (await response.json()) as T;
    this.trace({
      method: 'POST',
      path,
      url,
      status: response.status,
      responseBody: data,
      durationMs: Date.now() - start,
    });
    return data;
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /**
   * Atașează un link de factură la un pachet Trendyol.
   * POST /integration/sellers/{sellerId}/seller-invoice-links
   * Doc: { invoiceLink, shipmentPackageId } → 200 OK sau 409 dacă deja atașat.
   */
  sendInvoiceLink(invoiceLink: string, shipmentPackageId: number): Promise<void> {
    const path = `/integration/sellers/${this.sellerId}/seller-invoice-links`;
    return this.post<void>(path, { invoiceLink, shipmentPackageId });
  }
}
