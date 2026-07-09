import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { orders } from './orders.js';
import { products } from './products.js';

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceAmountMinor: bigint('unit_price_amount_minor', { mode: 'bigint' }).notNull(),
    unitPriceCurrency: char('unit_price_currency', { length: 3 }).notNull(),
    totalAmountMinor: bigint('total_amount_minor', { mode: 'bigint' })
      .notNull()
      .generatedAlwaysAs(sql`quantity * unit_price_amount_minor`),
    attributes: jsonb('attributes')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    originalSku: text('original_sku'),
    originalName: text('original_name'),
    originalProductId: uuid('original_product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    substitutedAt: timestamp('substituted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('order_items_order_id_idx').on(t.orderId),
    productIdx: index('order_items_product_id_idx').on(t.productId),
    quantityNonzero: check('order_items_quantity_nonzero', sql`${t.quantity} <> 0`),
  }),
);

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
