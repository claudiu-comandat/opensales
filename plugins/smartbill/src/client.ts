import type { PluginHttpLogFn, PluginLogger } from '@opensales/plugin-sdk';

import { SMARTBILL_API_URL, buildBasicAuthHeader } from './config.js';

// ── Tipuri publice request/response ────────────────────────────────────────────

/**
 * Date despre client (cumpărător) pentru o factură SmartBill.
 * Swagger §definitions/client.
 */
export interface SmartBillClientInfo {
  name: string;
  vatCode?: string | undefined;
  code?: string | undefined;
  address?: string | undefined;
  regCom?: string | undefined;
  isTaxPayer?: boolean | undefined;
  contact?: string | undefined;
  phone?: string | undefined;
  city?: string | undefined;
  county?: string | undefined;
  country?: string | undefined;
  email?: string | undefined;
  saveToDb?: boolean | undefined;
}

/** Linie de factură. Swagger §definitions/dateProdusGeneral1. */
export interface SmartBillProduct {
  name: string;
  code: string;
  measuringUnitName: string;
  currency: string;
  quantity: number;
  price: number;
  isTaxIncluded: boolean;
  taxName: string;
  taxPercentage: number;
  productDescription?: string | undefined;
  isService?: boolean | undefined;
  isDiscount?: boolean | undefined;
  discountValue?: number | undefined;
  discountPercentage?: number | undefined;
  saveToDb?: boolean | undefined;
  warehouseName?: string | undefined;
}

export interface SmartBillEmitInput {
  client: SmartBillClientInfo;
  products: SmartBillProduct[];
  seriesName?: string | undefined;
  currency?: string | undefined;
  issueDate?: string | undefined;
  dueDate?: string | undefined;
  language?: string | undefined;
  isDraft?: boolean | undefined;
  useStock?: boolean | undefined;
  mentions?: string | undefined;
  observations?: string | undefined;
  exchangeRate?: number | undefined;
}

/** Răspuns flat SmartBill (envelope XML-only ignorat — JSON e top-level). */
export interface SmartBillStandardResponse {
  errorText?: string | undefined;
  message?: string | undefined;
  number?: string | undefined;
  series?: string | undefined;
  url?: string | undefined;
  [k: string]: unknown;
}

export interface SmartBillEmitResponse extends SmartBillStandardResponse {
  number: string;
  series: string;
}

export interface SmartBillPaymentStatusResponse extends SmartBillStandardResponse {
  invoiceTotalAmount?: number | undefined;
  paidAmount?: number | undefined;
  unpaidAmount?: number | undefined;
}

export interface SmartBillPdfResponse {
  pdfBase64: string;
  contentType?: string | undefined;
}

export interface SmartBillRecordPaymentInput {
  value: number;
  type: string;
  currency?: string | undefined;
  paymentSeries?: string | undefined;
  issueDate?: string | undefined;
  isCash?: boolean | undefined;
  text?: string | undefined;
  observation?: string | undefined;
  useInvoiceDetails?: boolean | undefined;
  client?: SmartBillClientInfo | undefined;
  invoicesList: { seriesName: string; number: string }[];
}

export interface SmartBillTaxesResponse extends SmartBillStandardResponse {
  taxes?: { name?: string; percentage?: number }[] | undefined;
}

export interface SmartBillSeriesResponse extends SmartBillStandardResponse {
  list?: { name?: string; type?: string; nextNumber?: string }[] | undefined;
}

// ── Error types ────────────────────────────────────────────────────────────────

/** SmartBill a răspuns cu errorText nevid (eroare semantică, HTTP poate fi 200) sau HTTP >= 400. */
export class SmartBillApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly smartbillMessage: string;
  readonly raw: unknown;

  constructor(status: number, path: string, smartbillMessage: string, raw: unknown) {
    super(`SmartBill ${path} failed: ${smartbillMessage}`);
    this.name = 'SmartBillApiError';
    this.status = status;
    this.path = path;
    this.smartbillMessage = smartbillMessage;
    this.raw = raw;
  }
}

/** HTTP 403 — SmartBill blochează accesul când se depășește limita (30 apeluri / 10s). */
export class SmartBillRateLimitError extends SmartBillApiError {
  readonly retryAfterMs: number;
  constructor(path: string, retryAfterMs: number, raw: unknown) {
    super(403, path, 'Rate limit exceeded', raw);
    this.name = 'SmartBillRateLimitError';
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
export type SmartBillClientProvider = () => Promise<SmartBillClient>;

export interface SmartBillClientOptions {
  companyVatCode: string;
  username: string;
  token: string;
  logger: PluginLogger;
  /** Sink opțional pentru debug UI — wired de platformă, no-op în teste. */
  httpLog?: PluginHttpLogFn | undefined;
  fetchFn?: typeof fetch;
  /** Maxim retry-uri pe 403 (default 3). */
  maxRetries?: number;
  /** Timeout per request (default 30s). */
  timeoutMs?: number;
  /** Rate (req/sec) — default 3 (SmartBill: 30 apeluri / 10s). */
  perSecond?: number;
}

/**
 * Client HTTP pentru SmartBill Cloud REST API.
 *
 * Responsabilități:
 *   - Atașează `Authorization: Basic base64(email:token)` pe fiecare cerere
 *   - Trimite `companyVatCode` (CIF) pe fiecare apel autentificat (body sau query)
 *   - Serializează request-urile printr-un rate limiter (3 req/sec implicit)
 *   - Retry pe 403 (rate-limit) cu backoff exponențial
 *   - Mapează `errorText` nevid → SmartBillApiError (envelope la nivel de aplicație)
 *   - PDF-ul vine ca octet-stream → îl întoarce ca base64
 */
export class SmartBillClient {
  private readonly apiUrl: string;
  private readonly companyVatCode: string;
  private readonly authHeader: string;
  private readonly logger: PluginLogger;
  private readonly httpLog: PluginHttpLogFn | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;

  constructor(opts: SmartBillClientOptions) {
    this.apiUrl = SMARTBILL_API_URL.replace(/\/$/, '');
    this.companyVatCode = opts.companyVatCode;
    this.authHeader = buildBasicAuthHeader(opts.username, opts.token);
    this.logger = opts.logger;
    this.httpLog = opts.httpLog;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.limiter = new RateLimiter(opts.perSecond ?? 3);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async emit(input: SmartBillEmitInput): Promise<SmartBillEmitResponse> {
    const body = this.buildEmitBody(input);
    const res = await this.requestJson<SmartBillEmitResponse>('POST', '/invoice', body);
    if (!res.number || !res.series) {
      throw new SmartBillApiError(200, '/invoice', 'Răspuns fără serie/număr factură', res);
    }
    return res;
  }

  /** PUT /invoice/cancel — anulare fără ștergere. */
  async cancel(seriesName: string, number: string): Promise<SmartBillStandardResponse> {
    const qs = this.docQuery(seriesName, number);
    return this.requestJson<SmartBillStandardResponse>('PUT', `/invoice/cancel?${qs}`);
  }

  /** DELETE /invoice — doar ultima factură din serie poate fi ștearsă. */
  async deleteInvoice(seriesName: string, number: string): Promise<SmartBillStandardResponse> {
    const qs = this.docQuery(seriesName, number);
    return this.requestJson<SmartBillStandardResponse>('DELETE', `/invoice?${qs}`);
  }

  /** POST /invoice/reverse — emite factură storno pe baza facturii existente. */
  async storno(
    seriesName: string,
    number: string,
    issueDate?: string,
  ): Promise<SmartBillStandardResponse> {
    const body = stripUndefined({
      companyVatCode: this.companyVatCode,
      seriesName,
      number,
      issueDate,
    });
    return this.requestJson<SmartBillStandardResponse>('POST', '/invoice/reverse', body);
  }

  /** PUT /invoice/restore — restaurează o factură anulată. */
  async restore(seriesName: string, number: string): Promise<SmartBillStandardResponse> {
    const qs = this.docQuery(seriesName, number);
    return this.requestJson<SmartBillStandardResponse>('PUT', `/invoice/restore?${qs}`);
  }

  /** GET /invoice/paymentstatus — atenție: param `seriesname` e lowercase aici. */
  async getPaymentStatus(
    seriesName: string,
    number: string,
  ): Promise<SmartBillPaymentStatusResponse> {
    const qs = this.docQueryLower(seriesName, number);
    return this.requestJson<SmartBillPaymentStatusResponse>('GET', `/invoice/paymentstatus?${qs}`);
  }

  /** GET /invoice/pdf — `seriesname` lowercase; răspunsul e binar → base64. */
  async getPdf(seriesName: string, number: string): Promise<SmartBillPdfResponse> {
    const qs = this.docQueryLower(seriesName, number);
    return this.requestBinary(`/invoice/pdf?${qs}`);
  }

  /** POST /payment — înregistrează o încasare pe factură. */
  async recordPayment(input: SmartBillRecordPaymentInput): Promise<SmartBillStandardResponse> {
    const body = stripUndefined({ companyVatCode: this.companyVatCode, ...input });
    return this.requestJson<SmartBillStandardResponse>('POST', '/payment', body);
  }

  /** GET /tax — nomenclator cote TVA din contul SmartBill. */
  async getTaxes(): Promise<SmartBillTaxesResponse> {
    const qs = new URLSearchParams({ cif: this.companyVatCode }).toString();
    return this.requestJson<SmartBillTaxesResponse>('GET', `/tax?${qs}`);
  }

  /** GET /series — nomenclator serii de documente din contul SmartBill. */
  async getSeries(type?: string): Promise<SmartBillSeriesResponse> {
    const params = new URLSearchParams({ cif: this.companyVatCode });
    if (type) params.set('type', type);
    return this.requestJson<SmartBillSeriesResponse>('GET', `/series?${params.toString()}`);
  }

  // ── Helpers used by tests / debugging ──────────────────────────────────────

  /** Returnează body-ul complet care ar fi trimis la POST /invoice (fără request). */
  buildEmitBody(input: SmartBillEmitInput): Record<string, unknown> {
    return stripUndefined({
      companyVatCode: this.companyVatCode,
      client: stripUndefined({ ...input.client }),
      seriesName: input.seriesName,
      currency: input.currency,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      language: input.language,
      isDraft: input.isDraft,
      useStock: input.useStock,
      mentions: input.mentions,
      observations: input.observations,
      exchangeRate: input.exchangeRate,
      products: input.products.map((p) => stripUndefined({ ...p })),
    });
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  private docQuery(seriesName: string, number: string): string {
    return new URLSearchParams({
      cif: this.companyVatCode,
      seriesName,
      number,
    }).toString();
  }

  private docQueryLower(seriesName: string, number: string): string {
    return new URLSearchParams({
      cif: this.companyVatCode,
      seriesname: seriesName,
      number,
    }).toString();
  }

  private async requestJson<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const raw = (await this.request(method, path, body, 'application/json')) as Record<
      string,
      unknown
    >;
    return raw as T;
  }

  private async requestBinary(path: string): Promise<SmartBillPdfResponse> {
    const { bytes, contentType } = await this.requestBytes(path);
    const out: SmartBillPdfResponse = { pdfBase64: Buffer.from(bytes).toString('base64') };
    if (contentType) out.contentType = contentType;
    return out;
  }

  private async requestBytes(
    path: string,
  ): Promise<{ bytes: Uint8Array; contentType: string | null }> {
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
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: {
            Authorization: this.authHeader,
            Accept: 'application/octet-stream, application/json',
          },
          signal: controller.signal,
        });

        if (res.status === 403) {
          const retryAfterMs = this.computeRetryAfterMs(res, attempt);
          if (attempt >= this.maxRetries) {
            throw new SmartBillRateLimitError(path, retryAfterMs, await safeText(res));
          }
          await sleep(retryAfterMs);
          attempt += 1;
          continue;
        }

        if (res.status >= 400) {
          const text = await safeText(res);
          this.httpLog?.({
            method: 'GET',
            url,
            path: logPath,
            status: res.status,
            durationMs: Date.now() - attemptStartMs,
            error: `HTTP ${res.status}`,
          });
          throw new SmartBillApiError(res.status, path, `HTTP ${res.status}`, text);
        }

        const buffer = await res.arrayBuffer();
        this.httpLog?.({
          method: 'GET',
          url,
          path: logPath,
          status: res.status,
          durationMs: Date.now() - attemptStartMs,
        });
        return { bytes: new Uint8Array(buffer), contentType: res.headers.get('content-type') };
      } catch (e) {
        if (e instanceof SmartBillApiError) throw e;
        lastErr = e instanceof Error ? e : new Error(String(e));
        this.logger.error('SmartBill network error', { path, attempt, error: lastErr.message });
        attempt += 1;
        if (attempt > this.maxRetries) throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error('SmartBill request failed after retries');
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    accept: string,
  ): Promise<unknown> {
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
            Authorization: this.authHeader,
            Accept: accept,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          signal: controller.signal,
        };
        if (body !== undefined) init.body = JSON.stringify(body);
        const res = await this.fetchFn(url, init);

        if (res.status === 403) {
          const retryAfterMs = this.computeRetryAfterMs(res, attempt);
          this.logger.warn('SmartBill 403 rate limited', { path, attempt, retryAfterMs });
          if (attempt >= this.maxRetries) {
            const raw403 = await safeJson(res);
            this.httpLog?.({
              method,
              url,
              path: logPath,
              requestBody: body,
              status: 403,
              responseBody: raw403,
              durationMs: Date.now() - attemptStartMs,
              error: `Rate limited, retry after ${retryAfterMs}ms`,
            });
            throw new SmartBillRateLimitError(path, retryAfterMs, raw403);
          }
          await sleep(retryAfterMs);
          attempt += 1;
          continue;
        }

        const json = (await safeJson(res)) as Record<string, unknown>;
        const durationMs = Date.now() - attemptStartMs;

        if (res.status >= 400) {
          const msg = extractErrorText(json) ?? `HTTP ${res.status}`;
          this.logger.error('SmartBill HTTP error', { path, status: res.status, msg });
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
          throw new SmartBillApiError(res.status, path, msg, json);
        }

        const errorText = extractErrorText(json);
        if (errorText !== null && errorText.length > 0) {
          this.logger.error('SmartBill API error', { path, msg: errorText });
          this.httpLog?.({
            method,
            url,
            path: logPath,
            requestBody: body,
            status: res.status,
            responseBody: json,
            durationMs,
            error: errorText,
          });
          throw new SmartBillApiError(res.status, path, errorText, json);
        }

        this.logger.info('SmartBill OK', { method, path });
        this.httpLog?.({
          method,
          url,
          path: logPath,
          requestBody: body,
          status: res.status,
          responseBody: json,
          durationMs,
        });
        return json;
      } catch (e) {
        if (e instanceof SmartBillApiError) throw e;
        lastErr = e instanceof Error ? e : new Error(String(e));
        this.logger.error('SmartBill network error', { path, attempt, error: lastErr.message });
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
    throw lastErr ?? new Error('SmartBill request failed after retries');
  }

  private computeRetryAfterMs(res: Response, attempt: number): number {
    const reset = res.headers.get('x-ratelimit-reset');
    if (reset !== null) {
      const resetMs = Number(reset) * 1000 - Date.now();
      if (Number.isFinite(resetMs) && resetMs > 0) return Math.min(resetMs, 60_000);
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

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Extrage `errorText` din răspunsul SmartBill. Răspunsurile JSON sunt flat la
 * top-level, dar acceptăm și envelope-ul `sbcResponse` defensiv (XML→JSON).
 */
function extractErrorText(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.errorText === 'string') return obj.errorText;
  const wrapped = obj.sbcResponse;
  if (typeof wrapped === 'object' && wrapped !== null) {
    const inner = (wrapped as Record<string, unknown>).errorText;
    if (typeof inner === 'string') return inner;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
