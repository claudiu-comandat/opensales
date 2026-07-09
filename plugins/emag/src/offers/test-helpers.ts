import { vi } from 'vitest';

import { EmagClient } from '../client.js';
import { type EmagPlatformKey } from '../config.js';

/** Logger mut pentru teste — toate metodele sunt vi.fn(). */
export const silentLogger = (): {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

/** Helper pentru construit Response JSON cu structura standard eMAG. */
export const emagOkResponse = (results: unknown, status = 200): Response =>
  new Response(JSON.stringify({ isError: false, messages: [], results }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const emagErrorResponse = (messages: string[], status = 200): Response =>
  new Response(JSON.stringify({ isError: true, messages, results: [] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Construiește un EmagClient cu fetchFn mock. */
export const buildTestClient = (
  fetchFn: typeof fetch,
  platform: EmagPlatformKey = 'emag-ro',
): EmagClient =>
  new EmagClient({
    platform,
    username: 'u',
    password: 'p',
    logger: silentLogger(),
    fetchFn,
    maxRetries: 0,
  });
