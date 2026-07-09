import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export interface ProductImage {
  url: string;
  alt?: string | undefined;
}
export type ProductAttributes = Record<string, unknown>;

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    priceAmountMinor: bigint('price_amount_minor', { mode: 'bigint' }).notNull(),
    priceCurrency: char('price_currency', { length: 3 }).notNull(),
    stockQuantity: integer('stock_quantity').notNull().default(0),
    stockReserved: integer('stock_reserved').notNull().default(0),
    images: jsonb('images')
      .$type<ProductImage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    attributes: jsonb('attributes')
      .$type<ProductAttributes>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    isActive: boolean('is_active').notNull().default(true),
    brand: text('brand'),
    ean: text('ean'),
    stockCode: integer('stock_code'),
    vatRate: smallint('vat_rate'),
    purchasePriceAmountMinor: bigint('purchase_price_amount_minor', { mode: 'bigint' }),
    fullPriceAmountMinor: bigint('full_price_amount_minor', { mode: 'bigint' }),
    weightGrams: integer('weight_grams'),
    heightMm: integer('height_mm'),
    widthMm: integer('width_mm'),
    lengthMm: integer('length_mm'),
    warrantyMonths: smallint('warranty_months'),
    handlingTimeDays: smallint('handling_time_days'),
    numberOfPackages: smallint('number_of_packages'),
    stockZeroSince: timestamp('stock_zero_since', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skuUnique: uniqueIndex('products_sku_unique').on(t.sku),
    eanUnique: uniqueIndex('products_ean_unique')
      .on(t.ean)
      .where(sql`${t.ean} is not null`),
    stockCodeUnique: uniqueIndex('products_stock_code_unique')
      .on(t.stockCode)
      .where(sql`${t.stockCode} is not null`),
    activeIdx: index('products_active_idx')
      .on(t.id)
      .where(sql`${t.isActive} = true`),
    stockQtyNonNeg: check('stock_quantity_non_negative', sql`${t.stockQuantity} >= 0`),
    stockReservedNonNeg: check('products_stock_reserved_nonneg', sql`${t.stockReserved} >= 0`),
  }),
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
