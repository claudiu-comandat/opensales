import type { PluginHttpLogFn, PluginLogger } from '@opensales/plugin-sdk';

import {
  buildHashForCodUnic,
  buildHashForEmitere,
  buildHashForNomenclator,
  buildHashForNumar,
  buildHashForNumarFactura,
} from './auth.js';
import { resolveApiUrl, type FgoEnvironment } from './config.js';

// ── Tipuri publice request/response ────────────────────────────────────────────

/**
 * Date despre client (cumpărător) pentru o factură FGO.
 * Doc §2 facturi → Client[].
 */
export interface FgoClientInfo {
  Denumire: string;
  CodUnic?: string | undefined;
  Email?: string | undefined;
  Telefon?: string | undefined;
  Tara: string;
  Judet?: string | undefined;
  Localitate?: string | undefined;
  Adresa?: string | undefined;
  Tip: 'PF' | 'PJ';
  Strain?: boolean | undefined;
  IdExtern?: string | undefined;
}

/** Linie de factură. Doc §2 facturi → Continut[]. */
export interface FgoLineItem {
  Denumire: string;
  NrProduse: number;
  UM: string;
  CotaTVA: number;
  PretUnitar: number;
  Descriere?: string | undefined;
  CodArticol?: string | undefined;
  DiscountProcentual?: number | undefined;
}

export interface FgoEmitInput {
  Serie?: string | undefined;
  Numar?: string | undefined;
  Valuta?: string | undefined;
  TipFactura?: string | undefined;
  DataEmitere?: string | undefined;
  PlatformaUrl?: string | undefined;
  /** Informație liberă linie 1 — ex. numele clientului. */
  Text?: string | undefined;
  /** Informație liberă linie 2 — ex. "ID_COMANDA - MARKETPLACE - SKU|QTY, ...". */
  Explicatii?: string | undefined;
  Client: FgoClientInfo;
  Continut: FgoLineItem[];
  VerificareDuplicat?: boolean | undefined;
}

export interface FgoEmitResponse {
  Success: true;
  Factura: {
    Numar: string;
    Serie: string;
    Valoare: string;
    ValoareAchitata: string;
    Link?: string | undefined;
  };
}

/** Răspuns generic la operațiuni simple (anulare, stornare, status, încasare). */
export interface FgoStandardResponse {
  Success: true;
  Message?: string | undefined;
  Status?: string | undefined;
  [k: string]: unknown;
}

export interface FgoPdfResponse {
  Success: true;
  Pdf: string;
  ContentType?: string | undefined;
}

export interface FgoRecordPaymentInput {
  NumarFactura: string;
  SerieFactura?: string | undefined;
  Data: string;
  TipIncasare: string;
  Suma: number;
  Referinta?: string | undefined;
}

export interface FgoNomenclatureItem {
  Cod: string;
  Denumire: string;
}

// ── Error types ────────────────────────────────────────────────────────────────

/** FGO a răspuns cu Success:false (eroare semantică, HTTP poate fi 200). */
export class FgoApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly fgoMessage: string;
  readonly raw: unknown;

  constructor(status: number, path: string, fgoMessage: string, raw: unknown) {
    super(`FGO ${path} failed: ${fgoMessage}`);
    this.name = 'FgoApiError';
    this.status = status;
    this.path = path;
    this.fgoMessage = fgoMessage;
    this.raw = raw;
  }
}

/** HTTP 429 — caller poate retry-ui după retryAfterMs. */
export class FgoRateLimitError extends FgoApiError {
  readonly retryAfterMs: number;
  constructor(path: string, retryAfterMs: number, raw: unknown) {
    super(429, path, 'Rate limit exceeded', raw);
    this.name = 'FgoRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

// ── Rate limiter (token bucket simplu) ─────────────────────────────────────────

interface QueueEntry {
  resolve: () => void;
}

class RateLimiter {
  private readonly intervalMs: number;
  private nextAvailableAt = 0;
  private queue: QueueEntry[] = [];
  private draining = false;

  constructor(perSecond: number) {
    this.intervalMs = Math.ceil(1000 / perSecond);
  }

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        const wait = Math.max(0, this.nextAvailableAt - now);
        if (wait > 0) await sleep(wait);
        this.nextAvailableAt = Date.now() + this.intervalMs;
        const next = this.queue.shift();
        if (next) next.resolve();
      }
    } finally {
      this.draining = false;
    }
  }
}

// ── Client ─────────────────────────────────────────────────────────────────────

/** Lazy provider — folosit de action handlers ca să nu creeze clientul la registrare. */
export type FgoClientProvider = () => Promise<FgoClient>;

export interface FgoClientOptions {
  codUnic: string;
  privateKey: string;
  environment: FgoEnvironment;
  logger: PluginLogger;
  /** URL-ul platformei (trimis ca PlatformaUrl în query-ul nomenclatoarelor). */
  platformUrl?: string | undefined;
  /** Sink opțional pentru debug UI — wired de platformă, no-op în teste. */
  httpLog?: PluginHttpLogFn | undefined;
  fetchFn?: typeof fetch;
  /** Maxim retry-uri pe 429 (default 3). */
  maxRetries?: number;
  /** Timeout per request (default 30s). */
  timeoutMs?: number;
  /** Rate (req/sec) — default 1, conform doc FGO §0. */
  perSecond?: number;
}

/**
 * Client HTTP pentru FGO.
 *
 * Responsabilități:
 *   - Construiește hash-ul SHA-1 corect per endpoint (vezi auth.ts)
 *   - Serializează request-urile printr-un rate limiter (1 req/sec implicit)
 *   - Retry pe 429 cu backoff exponențial
 *   - Mapează `Success:false` la `FgoApiError`
 *   - Nomenclatoarele necesită GET cu auth (CodUnic + Hash + PlatformaUrl) — doc v7
 */
export class FgoClient {
  private readonly apiUrl: string;
  private readonly codUnic: string;
  private readonly privateKey: string;
  private readonly platformUrl: string | undefined;
  private readonly logger: PluginLogger;
  private readonly httpLog: PluginHttpLogFn | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;

  constructor(opts: FgoClientOptions) {
    this.apiUrl = resolveApiUrl(opts.environment).replace(/\/$/, '');
    this.codUnic = opts.codUnic;
    this.privateKey = opts.privateKey;
    this.platformUrl = opts.platformUrl;
    this.logger = opts.logger;
    this.httpLog = opts.httpLog;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.limiter = new RateLimiter(opts.perSecond ?? 1);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async emit(input: FgoEmitInput): Promise<FgoEmitResponse> {
    const hash = buildHashForEmitere(this.codUnic, this.privateKey, input.Client.Denumire);
    const body = stripUndefined({ CodUnic: this.codUnic, Hash: hash, ...input });
    return this.post<FgoEmitResponse>('/factura/emitere', body);
  }

  async cancel(numar: string, serie?: string): Promise<FgoStandardResponse> {
    const hash = buildHashForNumar(this.codUnic, this.privateKey, numar);
    const body = stripUndefined({ CodUnic: this.codUnic, Hash: hash, Numar: numar, Serie: serie });
    return this.post<FgoStandardResponse>('/factura/anulare', body);
  }

  async stergere(
    numar: string,
    serie?: string,
    platformaUrl?: string,
  ): Promise<FgoStandardResponse> {
    const hash = buildHashForNumar(this.codUnic, this.privateKey, numar);
    const body = stripUndefined({
      CodUnic: this.codUnic,
      Hash: hash,
      Numar: numar,
      Serie: serie,
      PlatformaUrl: platformaUrl,
    });
    return this.post<FgoStandardResponse>('/factura/stergere', body);
  }

  async storno(numar: string, serie?: string, platformaUrl?: string): Promise<FgoStandardResponse> {
    const hash = buildHashForNumar(this.codUnic, this.privateKey, numar);
    const body = stripUndefined({
      CodUnic: this.codUnic,
      Hash: hash,
      Numar: numar,
      Serie: serie,
      PlatformaUrl: platformaUrl,
    });
    return this.post<FgoStandardResponse>('/factura/stornare', body);
  }

  async getStatus(numar: string, serie?: string): Promise<FgoStandardResponse> {
    const hash = buildHashForNumar(this.codUnic, this.privateKey, numar);
    const body = stripUndefined({ CodUnic: this.codUnic, Hash: hash, Numar: numar, Serie: serie });
    return this.post<FgoStandardResponse>('/factura/getstatus', body);
  }

  async getPdf(numar: string, serie?: string): Promise<FgoPdfResponse> {
    const hash = buildHashForNumar(this.codUnic, this.privateKey, numar);
    const body = stripUndefined({ CodUnic: this.codUnic, Hash: hash, Numar: numar, Serie: serie });
    return this.post<FgoPdfResponse>('/factura/print', body);
  }

  async recordPayment(input: FgoRecordPaymentInput): Promise<FgoStandardResponse> {
    const hash = buildHashForNumarFactura(this.codUnic, this.privateKey, input.NumarFactura);
    const body = stripUndefined({ CodUnic: this.codUnic, Hash: hash, ...input });
    return this.post<FgoStandardResponse>('/factura/incasare', body);
  }

  /**
   * Nomenclator generic. Necesită auth GET cu query params — doc FGO v7.
   * Tipuri valide: tara, judet, tva, banca, valuta, tipincasare, tipfactura, tipclient, localitati.
   */
  async getNomenclature(tip: string): Promise<FgoNomenclatureItem[]> {
    const hash = buildHashForNomenclator(this.codUnic, this.privateKey);
    const params = new URLSearchParams({ CodUnic: this.codUnic, Hash: hash });
    if (this.platformUrl) params.set('PlatformaUrl', this.platformUrl);
    return this.get<FgoNomenclatureItem[]>(
      `/nomenclator/${encodeURIComponent(tip)}?${params.toString()}`,
    );
  }

  // ── Helpers used by tests / debugging ──────────────────────────────────────

  /** Returnează body-ul complet care ar fi trimis la /factura/emitere (fără a face request). */
  buildEmitBody(input: FgoEmitInput): Record<string, unknown> {
    const hash = buildHashForEmitere(this.codUnic, this.privateKey, input.Client.Denumire);
    return stripUndefined({ CodUnic: this.codUnic, Hash: hash, ...input });
  }

  /** Expune hash-ul pentru endpoint-urile /articol/* (out-of-scope MVP). */
  buildArticolHash(): string {
    return buildHashForCodUnic(this.codUnic, this.privateKey);
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body, true);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined, false);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    parseFgoEnvelope: boolean,
  ): Promise<T> {
    const url = `${this.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const logPath = path.includes('?') ? path.slice(0, path.indexOf('?')) : path;
    let attempt = 0;
    let lastErr: Error | null = null;
    let attemptStartMs = 0;
    while (attempt <= this.maxRetries) {
      await this.limiter.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      attemptStartMs = Date.now();
      try {
        const init: RequestInit = {
          method,
          headers: {
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          signal: controller.signal,
        };
        if (body !== undefined) init.body = JSON.stringify(body);
        const res = await this.fetchFn(url, init);

        if (res.status === 429) {
          const retryAfterMs = this.computeRetryAfterMs(res, attempt);
          this.logger.warn('FGO 429 rate limited', { path, attempt, retryAfterMs });
          if (attempt >= this.maxRetries) {
            const raw429 = await safeJson(res);
            const durationMs = Date.now() - attemptStartMs;
            this.httpLog?.({
              method,
              url,
              path: logPath,
              requestBody: body,
              status: 429,
              responseBody: raw429,
              durationMs,
              error: `Rate limited, retry after ${retryAfterMs}ms`,
            });
            throw new FgoRateLimitError(path, retryAfterMs, raw429);
          }
          this.httpLog?.({
            method,
            url,
            path: logPath,
            requestBody: body,
            status: 429,
            durationMs: Date.now() - attemptStartMs,
            error: `Rate limited (attempt ${attempt}), retry after ${retryAfterMs}ms`,
          });
          await sleep(retryAfterMs);
          attempt += 1;
          continue;
        }

        const json = (await safeJson(res)) as Record<string, unknown>;
        const durationMs = Date.now() - attemptStartMs;

        if (res.status >= 400) {
          const msg = extractMessage(json) ?? `HTTP ${res.status}`;
          this.logger.error('FGO HTTP error', { path, status: res.status, msg, raw: json });
          this.httpLog?.({
            method,
            url,
            path: logPath,
            requestBody: body,
            status: res.status,
            responseBody: json,
            durationMs,
            error: msg,
          });
          throw new FgoApiError(res.status, path, msg, json);
        }

        if (parseFgoEnvelope && json.Success === false) {
          const msg = extractMessage(json) ?? 'FGO Success:false';
          this.logger.error('FGO API error', { path, msg, raw: json });
          this.httpLog?.({
            method,
            url,
            path: logPath,
            requestBody: body,
            status: res.status,
            responseBody: json,
            durationMs,
            error: msg,
          });
          throw new FgoApiError(res.status, path, msg, json);
        }

        this.logger.info('FGO OK', { method, path });
        this.httpLog?.({
          method,
          url,
          path: logPath,
          requestBody: body,
          status: res.status,
          responseBody: json,
          durationMs,
        });
        return json as T;
      } catch (e) {
        if (e instanceof FgoApiError) throw e;
        lastErr = e instanceof Error ? e : new Error(String(e));
        this.logger.error('FGO network error', { path, attempt, error: lastErr.message });
        this.httpLog?.({
          method,
          url,
          path: logPath,
          requestBody: body,
          durationMs: Date.now() - attemptStartMs,
          error: lastErr.message,
        });
        attempt += 1;
        if (attempt > this.maxRetries) throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error('FGO request failed after retries');
  }

  private computeRetryAfterMs(res: Response, attempt: number): number {
    const ra = res.headers.get('retry-after');
    if (ra !== null) {
      const n = Number(ra);
      if (Number.isFinite(n) && n > 0) return Math.min(n * 1000, 60_000);
    }
    return Math.min(1000 * 2 ** attempt, 30_000);
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
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

function extractMessage(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const obj = json as { Message?: unknown; message?: unknown; Error?: unknown };
  if (typeof obj.Message === 'string') return obj.Message;
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.Error === 'string') return obj.Error;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
