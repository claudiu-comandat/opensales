import type { PluginHttpLogFn, PluginLogger } from '@opensales/plugin-sdk';

import { OLX_BASE_URL, OLX_DEFAULT_SCOPE, OLX_TOKEN_URL, OLX_VERSION_HEADER } from './config.js';

/**
 * Context-ul de autentificare cerut de un endpoint OLX.
 *   - `client`: grant_type=client_credentials — config data (categorii, orașe).
 *   - `user`:   grant_type=refresh_token — acțiuni în numele utilizatorului
 *               (adverts, messages). Necesită un refresh token.
 */
export type OlxAuthContext = 'client' | 'user';

/** Răspuns OLX la /api/open/oauth/token. */
export interface OlxTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token?: string;
}

/** Eroare semantică OLX (HTTP non-2xx). Doc § Errors. */
export class OlxApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly detail: string;
  readonly validation: { field?: string; title?: string; detail?: string }[];
  readonly raw: unknown;

  constructor(
    status: number,
    path: string,
    detail: string,
    validation: { field?: string; title?: string; detail?: string }[],
    raw: unknown,
  ) {
    const fields = validation
      .map((v) => `${v.field ?? '?'}: ${v.title ?? v.detail ?? ''}`)
      .join('; ');
    super(`OLX ${path} failed (${status}): ${detail}${fields ? ` [${fields}]` : ''}`);
    this.name = 'OlxApiError';
    this.status = status;
    this.path = path;
    this.detail = detail;
    this.validation = validation;
    this.raw = raw;
  }
}

/** 429 — too many requests. Permite caller-ului să decidă retry-ul. */
export class OlxRateLimitError extends OlxApiError {
  readonly retryAfterMs: number;
  constructor(path: string, retryAfterMs: number, raw: unknown) {
    super(429, path, 'Too many requests', [], raw);
    this.name = 'OlxRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export interface OlxClientOptions {
  clientId: string;
  clientSecret: string;
  /** Refresh token al utilizatorului (pentru context 'user'). */
  refreshToken?: string | undefined;
  logger: PluginLogger;
  /** Callback apelat când OLX rotește refresh token-ul, ca să-l persistăm. */
  onRefreshToken?: ((refreshToken: string) => void | Promise<void>) | undefined;
  /** Override pentru teste. */
  fetchFn?: typeof fetch;
  /** Sink pentru tracing HTTP — injectat de platformă. */
  httpLog?: PluginHttpLogFn | undefined;
  /** Maxim de retry-uri pe 429 (default 3). */
  maxRetries?: number;
  /** Backoff de bază pentru retry (default 500ms). */
  retryBaseMs?: number;
  /** Timeout per request (default 30s). */
  timeoutMs?: number;
  /** Scope cerut la obținerea token-ului. */
  scope?: string;
}

export interface OlxRequestOptions {
  context: OlxAuthContext;
  query?: Record<string, string | number | boolean | undefined> | undefined;
}

interface CachedToken {
  accessToken: string;
  /** Epoch ms la care expiră (cu margine de siguranță). */
  expiresAt: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Client HTTP pentru OLX Europe Partner API v2.
 *
 * Responsabilități:
 *   - OAuth2: token client_credentials (context 'client') sau refresh_token
 *     (context 'user'), cu cache pe access token și rotație a refresh token-ului.
 *   - Adaugă pe fiecare request `Authorization: Bearer <token>` + `Version: 2.0`.
 *   - Retry cu backoff pe 429; aruncă OlxApiError pe non-2xx.
 *   - Tracing HTTP best-effort (nu aruncă niciodată).
 */
export class OlxClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private refreshToken: string | undefined;
  private readonly logger: PluginLogger;
  private readonly onRefreshToken?: ((refreshToken: string) => void | Promise<void>) | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly httpLog?: PluginHttpLogFn | undefined;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly scope: string;

  private readonly tokens = new Map<OlxAuthContext, CachedToken>();

  constructor(opts: OlxClientOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.refreshToken = opts.refreshToken;
    this.logger = opts.logger;
    this.onRefreshToken = opts.onRefreshToken;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.httpLog = opts.httpLog;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.scope = opts.scope ?? OLX_DEFAULT_SCOPE;
  }

  get<T = unknown>(path: string, opts: OlxRequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, opts);
  }

  post<T = unknown>(path: string, body: unknown, opts: OlxRequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, opts);
  }

  put<T = unknown>(path: string, body: unknown, opts: OlxRequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, opts);
  }

  delete<T = unknown>(path: string, opts: OlxRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, opts);
  }

  private buildUrl(path: string, query?: OlxRequestOptions['query']): string {
    const base = `${OLX_BASE_URL}/${path.replace(/^\//, '')}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    opts: OlxRequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.maxRetries) {
      const token = await this.getAccessToken(opts.context);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = Date.now();
      try {
        const res = await this.fetchFn(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Version: OLX_VERSION_HEADER,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });

        if (res.status === 429) {
          const retryAfterMs = this.computeRetryAfterMs(res, attempt);
          this.logger.warn('OLX 429 rate limited', { path, attempt, retryAfterMs });
          if (attempt >= this.maxRetries) {
            const raw = await safeJson(res);
            this.trace(method, path, url, body, 429, raw, Date.now() - startedAt, 'rate_limit');
            throw new OlxRateLimitError(path, retryAfterMs, raw);
          }
          await sleep(retryAfterMs);
          attempt += 1;
          continue;
        }

        const durationMs = Date.now() - startedAt;
        if (res.status === 204) {
          this.trace(method, path, url, body, 204, undefined, durationMs);
          return undefined as T;
        }

        const json = await safeJson(res);
        if (res.status >= 400) {
          const { detail, validation } = extractError(json, res.status);
          this.logger.error('OLX API error', { path, status: res.status, detail });
          this.trace(method, path, url, body, res.status, json, durationMs, detail);
          throw new OlxApiError(res.status, path, detail, validation, json);
        }

        this.logger.info('OLX OK', { method, path, status: res.status });
        this.trace(method, path, url, body, res.status, json, durationMs);
        return json as T;
      } catch (err) {
        if (err instanceof OlxApiError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= this.maxRetries) break;
        await sleep(this.retryBaseMs * 2 ** attempt);
        attempt += 1;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error(`OLX ${path} failed`);
  }

  /** Returnează un access token valid pentru context, reînnoind dacă a expirat. */
  private async getAccessToken(context: OlxAuthContext): Promise<string> {
    const cached = this.tokens.get(context);
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

    const tokenBody = this.buildTokenRequest(context);
    const res = await this.fetchFn(OLX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokenBody),
    });
    const json = await safeJson(res);
    if (res.status >= 400 || !isRecord(json) || typeof json.access_token !== 'string') {
      const { detail, validation } = extractError(json, res.status);
      throw new OlxApiError(res.status, '/oauth/token', detail, validation, json);
    }

    const parsed = json as unknown as OlxTokenResponse;
    // Margine de 60s ca să nu folosim un token la limita expirării.
    const expiresAt = Date.now() + Math.max(0, (parsed.expires_in - 60) * 1000);
    this.tokens.set(context, { accessToken: parsed.access_token, expiresAt });

    if (context === 'user' && typeof parsed.refresh_token === 'string') {
      // OLX rotește refresh token-ul (unul nou emis zilnic) — persistă-l.
      if (parsed.refresh_token !== this.refreshToken) {
        this.refreshToken = parsed.refresh_token;
        void this.onRefreshToken?.(parsed.refresh_token);
      }
    }
    return parsed.access_token;
  }

  private buildTokenRequest(context: OlxAuthContext): Record<string, unknown> {
    if (context === 'client') {
      return {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: this.scope,
      };
    }
    if (!this.refreshToken) {
      throw new Error(
        'OLX user-context request requires a refresh token. Complete the authorization_code flow and configure refreshToken.',
      );
    }
    return {
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
    };
  }

  private computeRetryAfterMs(res: Response, attempt: number): number {
    const header = res.headers.get('Retry-After');
    if (header) {
      const seconds = Number(header);
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
    return this.retryBaseMs * 2 ** attempt;
  }

  private trace(
    method: string,
    path: string,
    url: string,
    requestBody: unknown,
    status: number,
    responseBody: unknown,
    durationMs: number,
    error?: string,
  ): void {
    if (!this.httpLog) return;
    try {
      this.httpLog({
        method,
        url,
        path,
        requestBody,
        status,
        responseBody,
        durationMs,
        ...(error ? { error } : {}),
      });
    } catch {
      // niciodată nu lăsa logging-ul să strice request-ul
    }
  }
}

function extractError(
  json: unknown,
  status: number,
): { detail: string; validation: { field?: string; title?: string; detail?: string }[] } {
  if (isRecord(json)) {
    const err = json.error;
    if (typeof err === 'string') {
      const desc =
        isRecord(json) && typeof json.error_description === 'string' ? json.error_description : err;
      return { detail: desc, validation: [] };
    }
    if (isRecord(err)) {
      const detail =
        typeof err.detail === 'string'
          ? err.detail
          : typeof err.title === 'string'
            ? err.title
            : `HTTP ${status}`;
      const validation = Array.isArray(err.validation)
        ? (err.validation as { field?: string; title?: string; detail?: string }[])
        : [];
      return { detail, validation };
    }
  }
  return { detail: `HTTP ${status}`, validation: [] };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
