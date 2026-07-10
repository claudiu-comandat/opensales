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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { orderItems } from './order-items.js';
import { orders } from './orders.js';

import type { OrderInvoice } from './orders.js';

/**
 * O procesare de retur parțial/total pentru o comandă. Cheia unică (orderId, source,
 * sourceReference) previne procesarea de două ori a aceluiași RMA eMAG / claim Trendyol la
 * retrimitere (retry, dublu-tap) — NULL-urile din sourceReference nu se ciocnesc între ele
 * (semantică standard SQL), deci returnurile 'manual' nu sunt deduplicate.
 */
export const orderReturns = pgTable(
  'order_returns',
  {
    id: uuid('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceReference: text('source_reference'),
    feeAmountMinor: bigint('fee_amount_minor', { mode: 'bigint' }),
    feeCurrency: char('fee_currency', { length: 3 }),
    comment: text('comment'),
    invoiceStorno: jsonb('invoice_storno').$type<OrderInvoice>(),
    invoiceReissue: jsonb('invoice_reissue').$type<OrderInvoice>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('order_returns_order_id_idx').on(t.orderId),
    sourceUnique: uniqueIndex('order_returns_order_source_reference_unique').on(
      t.orderId,
      t.source,
      t.sourceReference,
    ),
    sourceCheck: check(
      'order_returns_source_check',
      sql`${t.source} IN ('emag_rma', 'trendyol_claim', 'manual')`,
    ),
    // Sursele de marketplace TREBUIE să aibă sourceReference — altfel indexul unic (NULL-distinct)
    // nu deduplică, iar o retrimitere ar dubla stocul + factura storno.
    sourceReferenceRequired: check(
      'order_returns_source_reference_required',
      sql`${t.source} = 'manual' OR ${t.sourceReference} IS NOT NULL`,
    ),
    // Regula casei: amount_minor și currency mereu împreună (CLAUDE.md #8).
    feePairing: check(
      'order_returns_fee_pairing',
      sql`(${t.feeAmountMinor} IS NULL) = (${t.feeCurrency} IS NULL)`,
    ),
  }),
);

export type OrderReturn = typeof orderReturns.$inferSelect;
export type NewOrderReturn = typeof orderReturns.$inferInsert;

/** Cantitatea returnată per linie de comandă. Suma per orderItemId, peste toate rândurile, e plafonul (nu poate depăși order_items.quantity) — verificat în serviciu. */
export const orderReturnItems = pgTable(
  'order_return_items',
  {
    id: uuid('id').primaryKey().notNull(),
    orderReturnId: uuid('order_return_id')
      .notNull()
      .references(() => orderReturns.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderReturnIdx: index('order_return_items_order_return_id_idx').on(t.orderReturnId),
    orderItemIdx: index('order_return_items_order_item_id_idx').on(t.orderItemId),
    quantityPositive: check('order_return_items_quantity_positive', sql`${t.quantity} > 0`),
  }),
);

export type OrderReturnItem = typeof orderReturnItems.$inferSelect;
export type NewOrderReturnItem = typeof orderReturnItems.$inferInsert;
