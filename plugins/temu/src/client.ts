import type { PluginLogger } from '@opensales/plugin-sdk';

import { computeSign } from './sign.js';

// ─── Error types ─────────────────────────────────────────────────────────────

export class TemuApiError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    public readonly requestType: string,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = 'TemuApiError';
  }
}

export class TemuRateLimitError extends TemuApiError {
  constructor(requestType: string) {
    super('Temu rate limit exceeded (15 req/s)', '15 req/s limit', requestType, null);
    this.name = 'TemuRateLimitError';
  }
}

// ─── Response envelope ───────────────────────────────────────────────────────

/**
 * Envelope-ul răspunsului Temu Open API. Router-ul returnează camelCase
 * (`success`, `errorCode` ca număr, `errorMsg`, `requestId`). Acceptăm și
 * variantele snake_case pentru robustețe. Succes = success===true sau errorCode 1000000.
 */
export interface TemuResponse<T = unknown> {
  success?: boolean;
  errorCode?: number | string;
  errorMsg?: string;
  requestId?: string;
  /** Variante snake_case (defensiv). */
  error_code?: number | string;
  error_msg?: string;
  result: T;
}

// ─── Plugin-wide rate limiter — 15 req/s shared singleton ───────────────────
//
// Sliding-window: at most TEMU_MAX_PER_SEC request *launches* in any rolling
// 1 000 ms window. The limiter gates launch time only — it does NOT wait for
// the previous request's response, so multiple requests may be in-flight
// concurrently.  The singleton is declared at module level so ALL TemuClient
// instances (across platforms / credential sets) share a single 15/s budget.

export const TEMU_MAX_PER_SEC = 15;
const TEMU_WINDOW_MS = 1000;

/** Timestamps (ms) of recent request launches, oldest first. @internal */
const _launchTimes: number[] = [];

/**
 * Resets the rate-limiter state.  For use in tests ONLY — clears all recorded
 * launch timestamps so each test starts from a clean window.
 * @internal
 */
export function _resetTemuLimiterForTest(): void {
  _launchTimes.length = 0;
}

/**
 * Waits until it is safe to launch the next Temu HTTP request without
 * exceeding 15 starts in any rolling 1 000 ms window, then records the
 * launch time and resolves.  Multiple callers may be awaiting concurrently.
 */
export async function acquireTemuSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    // Evict timestamps older than 1 s
    const cutoff = now - TEMU_WINDOW_MS;
    while (_launchTimes.length > 0 && (_launchTimes[0] ?? 0) <= cutoff) {
      _launchTimes.shift();
    }
    if (_launchTimes.length < TEMU_MAX_PER_SEC) {
      _launchTimes.push(now);
      return;
    }
    // Wait until the oldest launch falls outside the window
    const oldestAllowed = _launchTimes[0] ?? now;
    const waitMs = oldestAllowed + TEMU_WINDOW_MS - now + 1;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, waitMs)));
  }
}

// ─── Client options ───────────────────────────────────────────────────────────

export interface TemuClientOptions {
  platform: string;
  apiUrl: string;
  appKey: string;
  appSecret: string;
  accessToken: string;
  logger: PluginLogger;
}

// ─── TemuClient ───────────────────────────────────────────────────────────────

export class TemuClient {
  private readonly apiUrl: string;
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly accessToken: string;
  private readonly logger: PluginLogger;

  constructor(opts: TemuClientOptions) {
    this.apiUrl = opts.apiUrl;
    this.appKey = opts.appKey;
    this.appSecret = opts.appSecret;
    this.accessToken = opts.accessToken;
    this.logger = opts.logger;
  }

  /**
   * Execută un apel Temu Open API.
   *
   * @param type   Numele metodei API, e.g. `bg.order.list.v2.get`
   * @param data   Payload-ul specific metodei (fără parametrii comuni)
   */
  async call<T = unknown>(type: string, data: Record<string, unknown> = {}): Promise<T> {
    await acquireTemuSlot();

    const timestamp = String(Math.floor(Date.now() / 1000));

    // Parametrii comuni incluși în semnătură
    const params: Record<string, unknown> = {
      type,
      app_key: this.appKey,
      access_token: this.accessToken,
      timestamp,
      data_type: 'JSON',
      ...data,
    };

    // Semnătura se calculează pe toți parametrii comuni + data, fără app_secret și sign
    const sign = computeSign(this.appSecret, params);

    const body: Record<string, unknown> = {
      ...params,
      sign,
    };

    // app_secret NU se trimite niciodată în request — doar pentru calculul sign.
    this.logger.debug('Temu API request', { type, timestamp });

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new TemuApiError(
        `HTTP ${response.status} pentru ${type}`,
        String(response.status),
        type,
        null,
      );
    }

    const envelope = (await response.json()) as TemuResponse<T>;
    const errorCode = envelope.errorCode ?? envelope.error_code;
    const errorMsg = envelope.errorMsg ?? envelope.error_msg;
    const ok = envelope.success === true || errorCode === 1000000 || errorCode === '1000000';

    if (!ok) {
      this.logger.warn('Temu API error', {
        type,
        errorCode,
        errorMsg,
        requestId: envelope.requestId,
      });
      throw new TemuApiError(
        `Temu API error [${String(errorCode ?? 'unknown')}]: ${errorMsg ?? 'unknown'}`,
        String(errorCode ?? 'unknown'),
        type,
        envelope,
      );
    }

    return envelope.result;
  }
}
