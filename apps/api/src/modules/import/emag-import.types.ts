import { z } from 'zod';

/**
 * Raw eMAG offer item shape as returned by `product_offer/read`.
 *
 * Schema is `.passthrough()` so unknown fields from eMAG (which evolves
 * its API frequently) don't break import. We only validate fields we map
 * to our domain.
 */
export const EmagOfferReadItemSchema = z
  .object({
    id: z.number(),
    part_number: z.string(),
    part_number_key: z.string().nullable().optional(),
    name: z.string(),
    description: z.string().nullable().optional(),
    brand: z.string().nullable().optional(),
    ean: z.array(z.string()).default([]),
    sale_price: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    recommended_price: z
      .union([z.number(), z.string()])
      .nullable()
      .optional()
      .transform((v) => (v !== null && v !== undefined ? Number(v) : null)),
    vat_id: z.number(),
    general_stock: z.number().default(0),
    estimated_stock: z.number().optional(),
    status: z.number(), // 0 inactive, 1 active, 2 EOL
    validation_status: z.unknown().optional(),
    offer_validation_status: z.unknown().optional(),
    images: z
      .array(
        z.object({
          url: z.string(),
          display_type: z.number().optional(),
        }),
      )
      .default([]),
    characteristics: z.array(z.unknown()).default([]),
  })
  .passthrough();

export type EmagOfferReadItem = z.infer<typeof EmagOfferReadItemSchema>;

/**
 * Envelope returned by the plugin's `syncOffers` action.
 */
export const EmagSyncOffersOutputSchema = z.object({
  items: z.array(z.record(z.unknown())),
  total: z.number().int().optional(),
  pages: z.number().int().optional(),
});

export type EmagSyncOffersOutput = z.infer<typeof EmagSyncOffersOutputSchema>;

/**
 * Output of `readVatRates` action (eMAG nomenclator, `vat/read`). Real shape per
 * plugins/emag/src/lookups/types.ts (EmagVatRate): `{ id, name?, value }`, where
 * `value` is a DECIMAL fraction (0.19 for 19%), not a percent integer.
 */
export const EmagVatRateItemSchema = z
  .object({
    id: z.number(),
    value: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  })
  .passthrough();

export type EmagVatRateItem = z.infer<typeof EmagVatRateItemSchema>;

export interface UpsertProductInput {
  sku: string;
  name: string;
  description: string | null;
  priceAmountMinor: bigint;
  priceCurrency: string;
  stockQuantity: number;
  images: { url: string; alt?: string }[];
  attributes: Record<string, unknown>;
  brand: string | null;
  ean: string | null;
  vatRate: number | null;
}

export interface UpsertListingInput {
  productId: string;
  pluginId: string;
  externalListingId: string;
  platform: string;
  status: 'active' | 'paused' | 'error';
  syncState: Record<string, unknown>;
}

export type EmagImportStatus = 'queued' | 'running' | 'done' | 'error';

export interface EmagImportError {
  offer_id: number | null;
  message: string;
}

export interface EmagImportProgress {
  jobId: string;
  status: EmagImportStatus;
  currentPage: number;
  totalPages: number;
  productsImported: number;
  listingsImported: number;
  errors: EmagImportError[];
  startedAt: string;
  finishedAt?: string;
}

export interface EmagImportJobData {
  jobId: string;
  pluginId: string;
  platformJobs: { platform: string; totalPages: number }[];
}
