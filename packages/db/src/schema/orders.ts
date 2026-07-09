import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { plugins } from './plugins.js';

export const orderStatusEnum = pgEnum('order_status', [
  'new',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'undelivered',
  'returned',
  'cancelled',
  'refunded',
]);

export interface OrderAddress {
  name?: string | undefined;
  street?: string | undefined;
  street2?: string | undefined;
  city?: string | undefined;
  county?: string | undefined;
  country?: string | undefined;
  zip?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  company?: string | undefined;
  vat_id?: string | undefined;
  /** ID-ul localității eMAG (necesar pentru awb/save). Stocat la sync. */
  locality_id?: number | undefined;
}

export interface OrderAwb {
  number: string;
  tracking?: string | undefined;
  tracking_url?: string | undefined;
  carrier_plugin_id: string;
  pdf_url?: string | undefined;
  status: 'pending' | 'issued' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';
  issued_at: string;
  /** ID intern eMAG returnat de awb/save. Necesar pentru awb/read (polling status) și awb/read_pdf. */
  emag_id?: number | undefined;
  /** Trendyol Pays: cargoTrackingNumber generat de Trendyol (necesar pentru getCommonLabel/↓PDF). */
  trendyol_tracking_number?: string | undefined;
}

export interface OrderDeliveryLocation {
  name?: string | undefined;
  type?: 'locker' | 'home' | undefined;
  courier_name?: string | undefined;
}

export interface OrderAttachment {
  name: string;
  url: string;
  /** 1=invoice, 3=warranty, 4=manual, 8=guide, 10=AWB, 11=proforma, 13=marketplace invoice */
  type?: number | undefined;
}

export interface OrderInvoice {
  series: string;
  number: string;
  pdf_url?: string | undefined;
  status: 'draft' | 'issued' | 'cancelled';
  issued_at: string;
}

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().notNull(),
    externalId: text('external_id').notNull(),
    pluginId: uuid('plugin_id').references(() => plugins.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull().default('new'),
    totalAmountMinor: bigint('total_amount_minor', { mode: 'bigint' }).notNull(),
    totalCurrency: char('total_currency', { length: 3 }).notNull(),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone'),
    customerName: text('customer_name'),
    billingAddress: jsonb('billing_address')
      .$type<OrderAddress>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    shippingAddress: jsonb('shipping_address')
      .$type<OrderAddress>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    awbOutgoing: jsonb('awb_outgoing').$type<OrderAwb>(),
    awbReturn: jsonb('awb_return').$type<OrderAwb>(),
    invoice: jsonb('invoice').$type<OrderInvoice>(),
    invoiceStorno: jsonb('invoice_storno').$type<OrderInvoice>(),
    shippingCostMinor: bigint('shipping_cost_minor', { mode: 'bigint' }),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }),
    vouchersMinor: bigint('vouchers_minor', { mode: 'bigint' }),
    paymentStatus: text('payment_status'),
    refundedAmountMinor: bigint('refunded_amount_minor', { mode: 'bigint' }),
    deliveryLocation: jsonb('delivery_location').$type<OrderDeliveryLocation>(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    attachments: jsonb('attachments').$type<OrderAttachment[]>(),
    /** Cod marketplace-ul sursă — ex. 'emag-ro', 'emag-hu', 'trendyol-gr'. Null pentru comenzi manuale sau ordine migrate. */
    marketplace: text('marketplace'),
    /** Modul de livrare: 'courier' = curier la domiciliu, 'pickup' = locker/easybox (transport eMag). */
    deliveryMode: text('delivery_mode'),
    /** JSON-ul brut primit de la marketplace la sync. Null pentru comenzi manuale/migrate. */
    rawPayload: jsonb('raw_payload'),
    /** Data la care clientul a solicitat anularea comenzii (ex. eMAG cancellation_request). Null dacă nu s-a cerut anulare. */
    cancellationRequest: text('cancellation_request'),
    stockReservationClaimed: boolean('stock_reservation_claimed').notNull().default(false),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    externalUnique: uniqueIndex('orders_plugin_external_unique').on(t.pluginId, t.externalId),
    statusIdx: index('orders_status_idx').on(t.status),
    placedAtIdx: index('orders_placed_at_idx').on(t.placedAt),
  }),
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
