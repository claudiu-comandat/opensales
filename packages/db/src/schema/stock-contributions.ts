import { pgTable, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { products } from './products.js';

/**
 * O linie per (sku, sourceOrderId): "am aplicat deja stocul acestei comenzi pentru
 * acest SKU". Cheia unică previne dublarea stocului la re-trimitere (retry, dublu-click,
 * re-rulare) a aceleiași comenzi de aprovizionare, permițând în același timp acumularea
 * corectă când comenzi diferite aduc stoc pentru același SKU.
 */
export const stockContributions = pgTable(
  'stock_contributions',
  {
    id: uuid('id').primaryKey().notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    sourceOrderId: text('source_order_id').notNull(),
    quantityApplied: integer('quantity_applied').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skuSourceOrderUnique: uniqueIndex('stock_contributions_sku_source_order_unique').on(
      t.sku,
      t.sourceOrderId,
    ),
  }),
);

export type StockContribution = typeof stockContributions.$inferSelect;
export type NewStockContribution = typeof stockContributions.$inferInsert;
