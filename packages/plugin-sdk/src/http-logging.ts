import { AsyncLocalStorage } from 'node:async_hooks';

import type { PluginHttpLogEntry, PluginHttpLogFn } from './context.js';

/**
 * Holds the active plugin's HTTP log sink for the duration of an action
 * invocation. `invokeAction` populates it (see plugin.ts); the patched global
 * `fetch` reads it. Outside an invocation the store is empty and fetch is a
 * no-op passthrough — so the platform's own HTTP calls are never logged.
 */
export const httpLogStore = new AsyncLocalStorage<PluginHttpLogFn | undefined>();

/** Header names whose values must never reach the debug store. */
const SENSITIVE_HEADER = /authorization|cookie|token|api-?key|secret|password/i;

const INSTALLED = Symbol.for('opensales.plugin-sdk.loggingFetchInstalled');

type FetchHeaders = NonNullable<Parameters<typeof fetch>[1]>['headers'];

function headersToRecord(headers: FetchHeaders): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  const normalized = headers instanceof Headers ? headers : new Headers(headers);
  normalized.forEach((v, k) => {
    out[k] = SENSITIVE_HEADER.test(k) ? '«redacted»' : v;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseMaybeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Wrap the global `fetch` ONCE so any request made while a plugin action is
 * executing (i.e. an httpLog sink is present in `httpLogStore`) is recorded
 * automatically — no per-plugin wiring required. Idempotent: safe to call more
 * than once. Call this at platform bootstrap, before any action runs.
 */
export function installLoggingFetch(): void {
  const g = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (g[INSTALLED]) return;

  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function loggingFetch(
    ...args: Parameters<typeof fetch>
  ): Promise<Response> {
    const sink = httpLogStore.getStore();
    if (!sink) return original(...args);

    const [input, init] = args;
    let url: string;
    let reqMethod: string | undefined;
    let reqHeaders: FetchHeaders;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
      reqMethod = input.method;
      reqHeaders = input.headers;
    }
    const method = (init?.method ?? reqMethod ?? 'GET').toUpperCase();
    const requestBody = typeof init?.body === 'string' ? parseMaybeJson(init.body) : undefined;
    const requestHeaders = headersToRecord(init?.headers ?? reqHeaders);
    const startedAt = Date.now();

    const emit = (extra: Partial<PluginHttpLogEntry>): void => {
      try {
        sink({
          method,
          url,
          path: pathOf(url),
          requestBody,
          requestHeaders,
          durationMs: Date.now() - startedAt,
          ...extra,
        });
      } catch {
        // logging must never break the request path
      }
    };

    try {
      const res = await original(...args);
      let responseBody: unknown;
      try {
        responseBody = parseMaybeJson(await res.clone().text());
      } catch {
        responseBody = undefined;
      }
      emit({ status: res.status, responseBody });
      return res;
    } catch (err) {
      emit({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };

  g[INSTALLED] = true;
}
