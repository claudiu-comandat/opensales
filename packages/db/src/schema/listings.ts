import { sql } from 'drizzle-orm';
import {
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
import { products } from './products.js';

export const listingStatusEnum = pgEnum('listing_status', [
  'draft',
  'active',
  'paused',
  'error',
  'pending_approval',
  'rejected',
]);

export interface ListingSyncState {
  last_sync_at?: string | undefined;
  last_error?: { message: string; at: string } | null | undefined;
  version?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  images?: { url: string }[] | undefined;
  price_amount_minor?: string | undefined;
  price_currency?: string | undefined;
  /** Stoc per-ofertă (override). Dacă lipsește, oferta folosește stocul produsului. */
  stock_quantity?: number | undefined;
  emag_offer_id?: number | undefined;
  trendyol_id?: number | undefined;
  productMainId?: string | undefined;
  approved?: boolean | undefined;
  archived?: boolean | undefined;
  reject_reasons?: string[] | undefined;
  marketplace?: string | undefined;
  category?: string | number | undefined;
  brand?: string | undefined;
  characteristics?: unknown;
  external_offer_id?: string | number | undefined;
  batch_request_id?: string | undefined;
  /** Temu: id-ul intern al produsului (SPU) returnat de goods.v2.add (result.goodsId). */
  temu_goods_id?: number | undefined;
  /** Temu: id-ul intern al SKU-ului (result.skuInfoList[].skuId, corelat prin outSkuSn). */
  temu_sku_id?: number | undefined;
  /** Datele brute importate de utilizator pentru această ofertă (debug). */
  raw_import?: unknown;
  /** Datele brute primite de la marketplace pentru această ofertă (debug). */
  raw_marketplace?: unknown;
  /**
   * Stare internă a ciclului de push (mai fină decât `status`). Pt. Trendyol:
   * pending (batch trimis) → submitted (item SUCCESS) → pending_approval → live;
   * retry_queued (atribut lipsă, reintră în batch-ul de retry); error (eșec final).
   */
  push_state?:
    | 'pending'
    | 'submitted'
    | 'pending_approval'
    | 'retry_queued'
    | 'live'
    | 'pushed'
    | 'rejected'
    | 'error'
    | undefined;
  /** Motivele de eșec la publicare (Trendyol failureReasons), pt. afișare în UI. */
  push_failure_reasons?: string[] | undefined;
  /** Câte runde de retry „Universal” s-au făcut pentru această ofertă. */
  retry_round?: number | undefined;
  /** Starea de aprobare urmărită din feed-ul Trendyol (unapproved). */
  approval_state?: 'pending_approval' | 'live' | 'rejected' | undefined;
  /** Atributele cărora li s-a aplicat `customAttributeValue: "Universal"` la retry. */
  universal_attr_ids?: number[] | undefined;
  /** ID-ul folosit pe Trendyol la primul push (stockCode); persistat ca să re-push-ul
   * să trimită același id și să actualizeze oferta existentă, nu să creeze un duplicat. */
  trendyol_stock_code?: number | undefined;
  /** Marchează că oferta trebuie re-sincronizată de reconcile-ul eMAG, chiar dacă are status stabil
   * (8/9). Se setează la push cu modificări de conținut; se curăță după ce reconcile-ul confirmă
   * noul status. */
  needs_validation_sync?: boolean | undefined;
  /** Ultima dată (ISO) când reconcile-ul eMAG a declanșat o corecție (categorie/brand/
   * mărime/traducere imagine) pentru această ofertă. Folosit ca cooldown — o ofertă
   * respinsă cronic nu e re-corectată la fiecare ciclu de 2h, ci cel mult o dată la 4h. */
  correction_attempted_at?: string | undefined;
  /** Barcode-ul specific ofertei pe marketplace (ex. varianta Trendyol). Poate
   * diferi de product.ean când același produs are EAN-uri diferite per canal. */
  barcode?: string | null | undefined;
  [key: string]: unknown;
}

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    externalListingId: text('external_listing_id').notNull(),
    platform: text('platform').notNull().default(''),
    status: listingStatusEnum('status').notNull().default('draft'),
    syncState: jsonb('sync_state')
      .$type<ListingSyncState>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    coupledColumns: text('coupled_columns').array(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pluginExternalUnique: uniqueIndex('listings_plugin_external_unique').on(
      t.pluginId,
      t.externalListingId,
    ),
    productPluginPlatformUnique: uniqueIndex('listings_product_plugin_platform_unique').on(
      t.productId,
      t.pluginId,
      t.platform,
    ),
    productIdx: index('listings_product_id_idx').on(t.productId),
    pluginStatusIdx: index('listings_plugin_status_idx').on(t.pluginId, t.status),
  }),
);

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
