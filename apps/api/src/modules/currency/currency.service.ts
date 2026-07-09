import https from 'node:https';

import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

const FRANKFURTER_HOST = 'api.frankfurter.dev';
const BASE = 'RON';
const SYMBOLS = 'EUR,USD,GBP,HUF,BGN,SAR,AED,KWD,CZK';
const LOOKBACK_DAYS = 10;

type DailyRates = Record<string, number>;
type RatesCache = Record<string, DailyRates>;

@Injectable()
export class CurrencyService {
  private readonly cache: RatesCache = {};
  private lastFetchedDate: string | null = null;

  constructor(private readonly logger: Logger) {}

  /**
   * Convert an amount from one currency to another using the Frankfurter exchange
   * rates (base RON). Fetches lazily and caches per calendar day.
   * Falls back up to 10 days for weekends/public holidays.
   */
  async convert(
    amount: number,
    from: string,
    to: string,
    date: Date = new Date(),
  ): Promise<number> {
    if (from === to || amount === 0) return amount;
    await this.ensureRates(date);
    const dateStr = date.toISOString().slice(0, 10);
    const fromRate = this.getRate(from, dateStr);
    const toRate = this.getRate(to, dateStr);
    // fromRate = units of `from` per 1 RON → amount / fromRate = amount in RON
    // toRate   = units of `to`   per 1 RON → amount_RON * toRate = amount in `to`
    return (amount / fromRate) * toRate;
  }

  /**
   * Convert minor-unit amounts (bigint) between currencies.
   * Rounds to the nearest minor unit in the target currency.
   */
  async convertMinor(
    amount: bigint,
    from: string,
    to: string,
    date: Date = new Date(),
  ): Promise<bigint> {
    if (from === to) return amount;
    const result = await this.convert(Number(amount), from, to, date);
    return BigInt(Math.round(result));
  }

  // Returns units of `currency` per 1 RON.
  // RON → 1. Looks back up to LOOKBACK_DAYS for missing dates (weekends/holidays).
  private getRate(currency: string, date: string): number {
    if (!currency || currency === BASE) return 1;
    const d = new Date(date + 'T00:00:00Z');
    for (let i = 0; i < LOOKBACK_DAYS; i++) {
      const key = d.toISOString().slice(0, 10);
      const rate = this.cache[key]?.[currency];
      if (rate) return rate;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    this.logger.warn({ currency, date }, 'currency rate not found — defaulting to 1');
    return 1;
  }

  private async ensureRates(date: Date): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    // Refresh the last 30 days once per calendar day
    if (this.lastFetchedDate !== today) {
      await this.fetchAndMerge(this.offsetDate(new Date(), -30), today);
      this.lastFetchedDate = today;
    }

    // For historical dates outside the 30-day window, fetch on demand
    if (!this.hasCoverageFor(date.toISOString().slice(0, 10))) {
      await this.fetchAndMerge(this.offsetDate(date, -14), date.toISOString().slice(0, 10));
    }
  }

  private hasCoverageFor(date: string): boolean {
    const d = new Date(date + 'T00:00:00Z');
    for (let i = 0; i < LOOKBACK_DAYS; i++) {
      if (this.cache[d.toISOString().slice(0, 10)]) return true;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return false;
  }

  private offsetDate(base: Date, days: number): string {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private async fetchAndMerge(from: string, to: string): Promise<void> {
    try {
      const path = `/v1/${from}..${to}?base=${BASE}&symbols=${SYMBOLS}`;
      const res = await this.httpGet<{ rates?: RatesCache }>(FRANKFURTER_HOST, path);
      if (res.rates) Object.assign(this.cache, res.rates);
    } catch (err) {
      this.logger.error({ err }, 'CurrencyService: failed to fetch rates from Frankfurter');
    }
  }

  private httpGet<T>(hostname: string, path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.get({ hostname, path, headers: { Accept: 'application/json' } }, (res) => {
        let body = '';
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(new Error(`Failed to parse Frankfurter response: ${String(e)}`));
          }
        });
      });
      req.on('error', reject);
    });
  }
}
