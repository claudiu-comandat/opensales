import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { plugins } from './plugins.js';

export const pluginRequestLog = pgTable(
  'plugin_request_log',
  {
    id: uuid('id').primaryKey().notNull(),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    url: text('url').notNull(),
    path: text('path').notNull(),
    requestBody: jsonb('request_body'),
    requestHeaders: jsonb('request_headers').$type<Record<string, string>>(),
    status: integer('status'),
    responseBody: jsonb('response_body'),
    responseSizeBytes: bigint('response_size_bytes', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    error: text('error'),
    /**
     * Free-form correlation fields extracted from the payload (e.g. eMAG order id),
     * so the debug UI can search a request log by external order id without parsing
     * the full body.
     */
    correlation: jsonb('correlation').$type<Record<string, string | number>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pluginIdx: index('plugin_request_log_plugin_idx').on(t.pluginId),
    pathIdx: index('plugin_request_log_path_idx').on(t.path),
    createdAtIdx: index('plugin_request_log_created_at_idx').on(t.createdAt),
  }),
);

export type PluginRequestLog = typeof pluginRequestLog.$inferSelect;
export type NewPluginRequestLog = typeof pluginRequestLog.$inferInsert;
