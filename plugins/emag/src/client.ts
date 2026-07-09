import type { PluginHttpLogFn, PluginLogger } from '@opensales/plugin-sdk';

import { resolveApiUrl } from './config.js';

import type { EmagPlatformKey } from './config.js';

/**
 * Format generic de răspuns eMAG. Doc 1.4 Response.
 *
 * Toate request-urile, indiferent de endpoint, returnează aceeași structură:
 *   { isError: bool, messages: string[], results: T }
 *
 * `isError === true` → eroare semantică, mesajul e în `messages`. NU este o
 * eroare HTTP (HTTP poate fi 200 cu isError=true). Trebuie tratat ca eroare.
 */
export interface EmagResponse<T = unknown> {
  isError: boolean;
  messages: string[] | { text?: string; message?: string }[];
  results: T;
  /** Pe unele endpoint-uri eMAG returnează metadata adițională la rădăcină. */
  [key: string]: unknown;
}

/** Aruncată când eMAG răspunde cu isError:true sau HTTP non-2xx. */
export class EmagApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly messages: string[];
  readonly raw: unknown;

  constructor(status: number, path: string, messages: string[], raw: unknown) {
    const summary = messages.length > 0 ? messages.join('; ') : `HTTP ${status}`;
    super(`eMAG ${path} failed: ${summary}`);
    this.name = 'EmagApiError';
    this.status = status;
    this.path = path;
    this.messages = messages;
    this.raw = raw;
  }
}

/** Aruncată specific când eMAG returnează 429. Permite caller-ului să retry-uiască. */
export class EmagRateLimitError extends EmagApiError {
  readonly retryAfterMs: number;
  constructor(path: string, retryAfterMs: number, raw: unknown) {
    super(429, path, ['Rate limit exceeded'], raw);
    this.name = 'EmagRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export interface EmagClientOptions {
  platform: EmagPlatformKey;
  username: string;
  password: string;
  logger: PluginLogger;
  /** Override pentru tests. */
  fetchFn?: typeof fetch;
  /** Maxim de retry-uri pe 429 (default 3). */
  maxRetries?: number;
  /** Timeout per request în ms (default 30s). */
  timeoutMs?: number;
  /** Sink pentru tracing HTTP — injectat de platformă prin PluginContext. */
  httpLog?: PluginHttpLogFn | undefined;
}

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Token bucket dual: 5 req/s + 200 req/min, cumulativ pe TOATE endpoint-urile
 * (doc 1.5 Rate limiting). Implementare in-memory — OK pentru un singur worker;
 * pentru multi-instance trebuie un bucket extern (Redis), dar la deploy
 * single-replica al API-ului OpenSales (vezi railway.toml numReplicas=1) e suficient.
 */
class RateLimiter {
  private secondTimestamps: number[] = [];
  private minuteTimestamps: number[] = [];
  private queue: QueueEntry[] = [];
  private draining = false;

  constructor(
    private readonly perSecond = 5,
    private readonly perMinute = 200,
  ) {}

  async acquire(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const wait = this.computeWaitMs();
        if (wait > 0) await this.sleep(wait);
        const now = Date.now();
        this.purgeOlderThan(this.secondTimestamps, now - 1_000);
        this.purgeOlderThan(this.minuteTimestamps, now - 60_000);
        if (
          this.secondTimestamps.length < this.perSecond &&
          this.minuteTimestamps.length < this.perMinute
        ) {
          this.secondTimestamps.push(now);
          this.minuteTimestamps.push(now);
          const next = this.queue.shift();
          if (next) next.resolve();
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private computeWaitMs(): number {
    const now = Date.now();
    this.purgeOlderThan(this.secondTimestamps, now - 1_000);
    this.purgeOlderThan(this.minuteTimestamps, now - 60_000);
    if (this.secondTimestamps.length >= this.perSecond) {
      const oldest = this.secondTimestamps[0] ?? now;
      return Math.max(0, oldest + 1_000 - now);
    }
    if (this.minuteTimestamps.length >= this.perMinute) {
      const oldest = this.minuteTimestamps[0] ?? now;
      return Math.max(0, oldest + 60_000 - now);
    }
    return 0;
  }

  private purgeOlderThan(arr: number[], threshold: number): void {
    while (arr.length > 0 && (arr[0] ?? 0) < threshold) arr.shift();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/**
 * Client HTTP pentru eMAG Marketplace API.
 *
 * Responsabilități:
 *   - Basic Auth: header `Authorization: Basic base64(user:pass)`
 *   - Rate limiting cumulativ (5/s + 200/min)
 *   - Backoff exponential + retry pe 429
 *   - Unwrap `EmagResponse` și aruncă `EmagApiError` la `isError:true`
 *   - Logging la fiecare request (calea + status + messages dacă isError)
 *
 * Toate metodele post primesc obiectul JS direct; clientul se ocupă de
 * serializare ca form-encoded `data=<json>` (formatul preferat eMAG) sau
 * JSON pur (când endpoint-ul cere asta). Endpoint-urile noi (4.4.9+) folosesc
 * JSON; cele vechi acceptă ambele.
 */
export class EmagClient {
  private readonly apiUrl: string;
  private readonly authHeader: string;
  private readonly logger: PluginLogger;
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly httpLog?: PluginHttpLogFn | undefined;
  private readonly limiter = new RateLimiter();

  constructor(opts: EmagClientOptions) {
    this.apiUrl = resolveApiUrl(opts.platform).replace(/\/$/, '');
    this.authHeader = `Basic ${this.toBase64(`${opts.username}:${opts.password}`)}`;
    this.logger = opts.logger;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.httpLog = opts.httpLog;
  }

  /**
   * Best-effort tracing — never throws, never blocks. Extracts an order id
   * from the request/response payload (eMAG endpoints almost always carry
   * one), so the debug UI can search by external order id.
   */
  private trace(entry: {
    method: string;
    path: string;
    url: string;
    requestBody: unknown;
    status?: number;
    responseBody?: unknown;
    durationMs?: number;
    error?: string;
  }): void {
    if (!this.httpLog) return;
    try {
      const correlation = extractCorrelation(entry.requestBody, entry.responseBody);
      this.httpLog({
        method: entry.method,
        url: entry.url,
        path: entry.path,
        requestBody: entry.requestBody,
        status: entry.status,
        responseBody: entry.responseBody,
        durationMs: entry.durationMs,
        error: entry.error,
        correlation: Object.keys(correlation).length > 0 ? correlation : undefined,
      });
    } catch {
      // never let logging break the request path
    }
  }

  /**
   * GET-style read. eMAG acceptă filtre ca query params sau ca POST body cu
   * `data={"filter":{...}}`. Folosim varianta POST pentru consistență (eMAG
   * recomandă POST pentru orice endpoint care primește filtre).
   */
  read<T = unknown>(resource: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.call<T>(`${resource}/read`, body);
  }

  count<T = { noOfItems?: number }>(
    resource: string,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    return this.call<T>(`${resource}/count`, body);
  }

  save<T = unknown>(resource: string, body: unknown): Promise<T> {
    return this.call<T>(`${resource}/save`, body);
  }

  /**
   * Endpoint generic — orice path relativ. Folosit pentru endpoint-urile non-CRUD
   * (`order/acknowledge/{id}`, `order/{id}/unlock-courier`, `awb/read_pdf/{id}`,
   * `offer_stock/{id}`, etc.).
   */
  call<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** PATCH endpoint — light update single field (e.g. offer_stock). */
  patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  /**
   * Like `call`, but returns the FULL envelope (including pagination metadata
   * at the root level: `noOfItems`, `currentPage`, `itemsPerPage`). Use when
   * you need totals from paginated reads.
   */
  async callEnvelope<T = unknown>(path: string, body: unknown): Promise<EmagResponse<T>> {
    const url = `${this.apiUrl}/${path.replace(/^\//, '')}`;
    let attempt = 0;
    let lastErr: Error | null = null;
    while (attempt <= this.maxRetries) {
      await this.limiter.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = Date.now();
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body === undefined ? null : JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.status === 429) {
          const retryAfterMs = this.computeRetryAfterMs(res, attempt);
          this.logger.warn('eMAG 429 rate limited', { path, attempt, retryAfterMs });
          if (attempt >= this.maxRetries) {
            const raw = await safeJson(res);
            this.trace({
              method: 'POST',
              path,
              url,
              requestBody: body,
              status: 429,
              responseBody: raw,
              durationMs: Date.now() - startedAt,
              error: 'rate_limit',
            });
            throw new EmagRateLimitError(path, retryAfterMs, raw);
          }
          await sleep(retryAfterMs);
          attempt += 1;
          continue;
        }
        const json = (await safeJson(res)) as EmagResponse<T> | { message?: string };
        const durationMs = Date.now() - startedAt;
        if (res.status >= 400 || ('isError' in json && json.isError === true)) {
          const messages = extractMessages(json);
          this.logger.error('eMAG API error', { path, status: res.status, messages });
          this.trace({
            method: 'POST',
            path,
            url,
            requestBody: body,
            status: res.status,
            responseBody: json,
            durationMs,
            error: messages.join('; '),
          });
          throw new EmagApiError(res.status, path, messages, json);
        }
        this.logger.info('eMAG OK envelope', { path });
        this.trace({
          method: 'POST',
          path,
          url,
          requestBody: body,
          status: res.status,
          responseBody: json,
          durationMs,
        });
        return json as EmagResponse<T>;
      } catch (e) {
        if (e instanceof EmagApiError) throw e;
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt >= this.maxRetries) {
          this.trace({
            method: 'POST',
            path,
            url,
            requestBody: body,
            durationMs: Date.now() - startedAt,
            error: lastErr.message,
          });
        }
        attempt += 1;
        if (attempt > this.maxRetries) throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error('eMAG request failed after retries');
  }

  /** GET endpoint — pentru read_pdf binary (returnează octets, nu JSON). */
  async getRaw(
    path: string,
  ): Promise<{ status: number; bytes: Uint8Array; contentType: string | null }> {
    await this.limiter.acquire();
    const url = `${this.apiUrl}/${path.replace(/^\//, '')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: { Authorization: this.authHeader },
        signal: controller.signal,
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      this.logger.info('eMAG GET', { path, status: res.status, size: buf.byteLength });
      if (res.status >= 400) {
        const text = new TextDecoder('utf-8').decode(buf).slice(0, 500);
        throw new EmagApiError(res.status, path, [`HTTP ${res.status}: ${text}`], {
          status: res.status,
        });
      }
      return { status: res.status, bytes: buf, contentType: res.headers.get('content-type') };
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
    const url = `${this.apiUrl}/${path.replace(/^\//, '')}`;
    let attempt = 0;
    let lastErr: Error | null = null;
    while (attempt <= this.maxRetries) {
      await this.limiter.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const startedAt = Date.now();
      try {
        // eMAG legacy endpoints expect form-encoded `data=<json>`; new ones
        // accept JSON. We send JSON (Content-Type: application/json) which
        // both styles accept.
        const res = await this.fetchFn(url, {
          method,
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body === undefined ? null : JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.status === 429) {
          const retryAfterMs = this.computeRetryAfterMs(res, attempt);
          this.logger.warn('eMAG 429 rate limited', { path, attempt, retryAfterMs });
          if (attempt >= this.maxRetries) {
            const raw = await safeJson(res);
            this.trace({
              method,
              path,
              url,
              requestBody: body,
              status: 429,
              responseBody: raw,
              durationMs: Date.now() - startedAt,
              error: 'rate_limit',
            });
            throw new EmagRateLimitError(path, retryAfterMs, raw);
          }
          await sleep(retryAfterMs);
          attempt += 1;
          continue;
        }
        const json = (await safeJson(res)) as EmagResponse<T> | { message?: string };
        const durationMs = Date.now() - startedAt;
        if (res.status >= 400 || ('isError' in json && json.isError === true)) {
          const messages = extractMessages(json);
          this.logger.error('eMAG API error', { path, status: res.status, messages });
          this.trace({
            method,
            path,
            url,
            requestBody: body,
            status: res.status,
            responseBody: json,
            durationMs,
            error: messages.join('; '),
          });
          throw new EmagApiError(res.status, path, messages, json);
        }
        const wrapped = json as EmagResponse<T>;
        this.logger.info('eMAG OK', { method, path });
        this.trace({
          method,
          path,
          url,
          requestBody: body,
          status: res.status,
          responseBody: json,
          durationMs,
        });
        return wrapped.results;
      } catch (e) {
        if (e instanceof EmagApiError) throw e;
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt >= this.maxRetries) {
          this.trace({
            method,
            path,
            url,
            requestBody: body,
            durationMs: Date.now() - startedAt,
            error: lastErr.message,
          });
        }
        attempt += 1;
        if (attempt > this.maxRetries) throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error('eMAG request failed after retries');
  }

  private computeRetryAfterMs(res: Response, attempt: number): number {
    // Retry-After (seconds) > X-RateLimit-Reset (epoch sec) > exponential backoff
    const ra = res.headers.get('retry-after');
    if (ra !== null) {
      const n = Number(ra);
      if (Number.isFinite(n) && n > 0) return Math.min(n * 1000, 60_000);
    }
    return Math.min(1000 * 2 ** attempt, 30_000);
  }

  private toBase64(input: string): string {
    if (typeof Buffer !== 'undefined') return Buffer.from(input, 'utf8').toString('base64');
    // Fallback for non-Node runtimes (shouldn't happen on the platform)
    return btoa(unescape(encodeURIComponent(input)));
  }
}

/**
 * Best-effort: pull common identifiers out of an eMAG request/response so the
 * debug UI can search a log by external order id. eMAG endpoints carry the
 * order id either in the request body (`order/save`, `order/acknowledge/{id}`
 * via path, `order/attachments/read` with `order_id`), in `results[*].id`
 * (for `order/read`), or both.
 */
function extractCorrelation(
  requestBody: unknown,
  responseBody: unknown,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const pickId = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    return undefined;
  };
  if (requestBody !== null && typeof requestBody === 'object') {
    const r = requestBody as Record<string, unknown>;
    const candidate = r.order_id ?? r.orderId ?? r.id;
    const n = pickId(candidate);
    if (n !== undefined) out.externalOrderId = n;
  }
  if (responseBody !== null && typeof responseBody === 'object') {
    const r = responseBody as { results?: unknown };
    if (Array.isArray(r.results)) {
      const ids: number[] = [];
      for (const item of r.results) {
        if (item !== null && typeof item === 'object') {
          const n = pickId((item as { id?: unknown }).id);
          if (n !== undefined) ids.push(n);
          if (ids.length >= 5) break;
        }
      }
      if (ids.length > 0) out.responseIds = ids.join(',');
    }
  }
  return out;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (text.length === 0) return {};
    return JSON.parse(text) as unknown;
  } catch {
    return { _parse_error: true };
  }
}

function extractMessages(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) return ['unknown error'];
  const obj = json as { messages?: unknown; message?: unknown };
  if (typeof obj.message === 'string') return [obj.message];
  if (!Array.isArray(obj.messages)) return [];
  return obj.messages.map((m) => {
    if (typeof m === 'string') return m;
    if (m !== null && typeof m === 'object') {
      const n = m as { text?: string; message?: string };
      return n.text ?? n.message ?? JSON.stringify(m);
    }
    return String(m);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
