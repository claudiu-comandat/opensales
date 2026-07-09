import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Un lot de import asincron pornit prin `POST /import/products`.
 *
 * Request-ul răspunde instant cu planul per SKU (validările făcute în bloc),
 * apoi un worker procesează efectiv produsele + ofertele în background.
 * `results` este suprascris cu rezultatele reale pe măsură ce avansează.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().notNull(),
    /** processing | completed | failed */
    status: text('status').notNull().default('processing'),
    totalProducts: integer('total_products').notNull(),
    processedProducts: integer('processed_products').notNull().default(0),
    /** Plan inițial, apoi rezultatele reale per SKU (SkuResult[]). */
    results: jsonb('results').$type<unknown[]>().notNull().default([]),
    /** Payload-ul validat (JSON-safe: prețurile ca string), re-parsat de worker. */
    input: jsonb('input').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('import_batches_status_idx').on(t.status),
    createdAtIdx: index('import_batches_created_at_idx').on(t.createdAt),
  }),
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
