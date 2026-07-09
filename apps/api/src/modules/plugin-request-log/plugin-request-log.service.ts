import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { and, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import type { Database } from '@opensales/db';

const MAX_BODY_BYTES = 50_000;
// Logurile sunt voluminoase (request/response jsonb) — păstrăm doar o fereastră
// scurtă. Prune des (orar) ca tabela să nu depășească ~7h și să nu umfle RAM/disk.
const RETENTION_HOURS = 7;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface RequestLogEntry {
  pluginId: string;
  method: string;
  url: string;
  path: string;
  requestBody?: unknown;
  requestHeaders?: Record<string, string> | undefined;
  status?: number | undefined;
  responseBody?: unknown;
  durationMs?: number | undefined;
  error?: string | undefined;
  correlation?: Record<string, string | number> | undefined;
}

export interface RequestLogFilter {
  pluginId?: string | undefined;
  path?: string | undefined;
  search?: string | undefined;
  since?: Date | undefined;
  limit?: number | undefined;
  /** Dacă true, returnează DOAR înregistrările sintetice de erori Zod (pre-HTTP). */
  validationErrors?: boolean | undefined;
}

function truncateForStorage(value: unknown): {
  truncated: unknown;
  sizeBytes: number;
} {
  if (value === undefined || value === null) return { truncated: value, sizeBytes: 0 };
  let str: string;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return { truncated: { _serialize_error: true }, sizeBytes: 0 };
  }
  const sizeBytes = Buffer.byteLength(str, 'utf8');
  if (sizeBytes <= MAX_BODY_BYTES) {
    return { truncated: value, sizeBytes };
  }
  return {
    truncated: {
      _truncated: true,
      preview: str.slice(0, MAX_BODY_BYTES),
      originalSizeBytes: sizeBytes,
    },
    sizeBytes,
  };
}

@Injectable()
export class PluginRequestLogService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    void this.pruneOld();
    setInterval(() => void this.pruneOld(), PRUNE_INTERVAL_MS);
  }

  async record(entry: RequestLogEntry): Promise<void> {
    try {
      const { truncated: reqBody } = truncateForStorage(entry.requestBody);
      const { truncated: resBody, sizeBytes: resSize } = truncateForStorage(entry.responseBody);
      await this.db.insert(schema.pluginRequestLog).values({
        id: uuidv7(),
        pluginId: entry.pluginId,
        method: entry.method,
        url: entry.url,
        path: entry.path,
        requestBody: reqBody ?? null,
        requestHeaders: entry.requestHeaders ?? null,
        status: entry.status ?? null,
        responseBody: resBody ?? null,
        responseSizeBytes: resSize > 0 ? resSize : null,
        durationMs: entry.durationMs ?? null,
        error: entry.error ?? null,
        correlation: entry.correlation ?? null,
      });
    } catch (err) {
      this.logger.warn(
        { err, pluginId: entry.pluginId, path: entry.path },
        'plugin_request_log insert failed',
      );
    }
  }

  async list(filter: RequestLogFilter = {}): Promise<schema.PluginRequestLog[]> {
    const conditions = [];
    if (filter.pluginId) conditions.push(eq(schema.pluginRequestLog.pluginId, filter.pluginId));
    if (filter.path) conditions.push(ilike(schema.pluginRequestLog.path, `%${filter.path}%`));
    if (filter.since) conditions.push(gte(schema.pluginRequestLog.createdAt, filter.since));
    if (filter.search) {
      const term = `%${filter.search}%`;
      conditions.push(
        or(
          sql`${schema.pluginRequestLog.requestBody}::text ILIKE ${term}`,
          sql`${schema.pluginRequestLog.responseBody}::text ILIKE ${term}`,
          sql`${schema.pluginRequestLog.correlation}::text ILIKE ${term}`,
        ),
      );
    }
    if (filter.validationErrors) {
      conditions.push(sql`${schema.pluginRequestLog.url} ILIKE '[validation-error]%'`);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return this.db
      .select()
      .from(schema.pluginRequestLog)
      .where(where)
      .orderBy(desc(schema.pluginRequestLog.createdAt))
      .limit(Math.min(filter.limit ?? 100, 500));
  }

  async getById(id: string): Promise<schema.PluginRequestLog | null> {
    const rows = await this.db
      .select()
      .from(schema.pluginRequestLog)
      .where(eq(schema.pluginRequestLog.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async pruneOld(): Promise<number> {
    try {
      // Fără RETURNING — cu RETURNING, driver-ul materializează un rând per
      // ștergere doar ca să-l numere, ceea ce umflă memoria degeaba la backlog
      // mare (ex. după o pauză). postgres.js expune numărul de rânduri afectate
      // direct din command tag (`result.count`), fără nicio scanare în plus.
      const result = await this.db.execute(sql`
        DELETE FROM plugin_request_log
        WHERE created_at < now() - INTERVAL '${sql.raw(String(RETENTION_HOURS))} hours'
      `);
      return result.count ?? 0;
    } catch (err) {
      this.logger.warn({ err }, 'plugin_request_log prune failed');
      return 0;
    }
  }
}
