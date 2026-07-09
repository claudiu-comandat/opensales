import { z } from 'zod';

/**
 * Raw Trendyol product item shape as returned by `filterProducts`.
 *
 * Schema is `.passthrough()` so unknown fields from Trendyol (which evolves
 * its API frequently) don't break import. We only validate fields we map
 * to our domain.
 */
/**
 * Trendyol V2 product shape (endpoint /products/approved și /products/unapproved).
 *
 * Diferențe față de V1:
 *  - `contentId`  înlocuiește `id`
 *  - `brand`      este un obiect `{ id, name }` în loc de string simplu
 *  - `category`   este un obiect `{ id, name }` în loc de `categoryName: string`
 *  - câmpurile de preț, stoc, vatRate, barcode, archived, onSale sunt în `variants[]`
 */
export const TrendyolProductSchema = z
  .object({
    // Unapproved products have no contentId yet — keep it optional and fall back
    // to productMainId for the listing key.
    contentId: z.number().nullable().optional(),
    productMainId: z.string(),
    productCode: z.union([z.string(), z.number()]).optional(),
    title: z.string(),
    description: z.string().nullable().optional().default(''),
    brand: z
      .union([z.string(), z.object({ id: z.number().optional(), name: z.string() }).passthrough()])
      .optional(),
    category: z.object({ id: z.number().optional(), name: z.string() }).passthrough().optional(),
    images: z.array(z.object({ url: z.string() }).passthrough()).default([]),
    attributes: z.array(z.unknown()).default([]),
    variants: z
      .array(
        z
          .object({
            // Cross-border target storefronts (e.g. GR) may carry a null price
            // until an independent update is sent — keep these tolerant.
            price: z
              .object({
                salePrice: z.number().nullable().optional(),
                listPrice: z.number().nullable().optional(),
              })
              .passthrough()
              .optional(),
            stock: z
              .object({ quantity: z.number().nullable().optional() })
              .passthrough()
              .optional(),
            // Cross-border target storefronts may send vatRate as null.
            vatRate: z.number().nullable().optional(),
            barcode: z.string().optional(),
            stockCode: z.string().optional(),
            archived: z.boolean().default(false),
            onSale: z.boolean().optional(),
            blacklisted: z.boolean().default(false),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export type TrendyolProduct = z.infer<typeof TrendyolProductSchema>;

/**
 * Envelope returned by the plugin's `filterProducts` action.
 */
export const TrendyolFilterOutputSchema = z.object({
  page: z.number(),
  size: z.number(),
  totalElements: z.number(),
  totalPages: z.number(),
  content: z.array(z.record(z.unknown())),
  /** Cursor către pagina următoare (V2); absent/null pe ultima pagină. */
  nextPageToken: z.string().nullable().optional(),
});

export type TrendyolFilterOutput = z.infer<typeof TrendyolFilterOutputSchema>;

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

export type TrendyolImportStatus = 'queued' | 'running' | 'done' | 'error';

export interface TrendyolImportError {
  product_id: number | null;
  message: string;
}

export interface TrendyolImportProgress {
  jobId: string;
  status: TrendyolImportStatus;
  currentPage: number;
  totalPages: number;
  productsImported: number;
  listingsImported: number;
  skipped: number;
  errors: TrendyolImportError[];
  startedAt: string;
  finishedAt?: string;
}

/** One per product seen during an import — used by the debug report. */
export interface TrendyolImportDebugRecord {
  storefront: string;
  approved: boolean;
  contentId: number | null;
  productMainId: string | null;
  barcode: string | null;
  outcome: 'imported' | 'ignored' | 'invalid';
  /** Zod validation message when outcome === 'invalid'. */
  error?: string;
}

export interface TrendyolImportDebugReport {
  totalRecords: number;
  byStorefront: Record<
    string,
    { seen: number; imported: number; ignored: number; invalid: number }
  >;
  distinctContentIds: number;
  /** contentIds that appear under more than one storefront (collapse risk). */
  crossStorefrontContentIds: number;
  records: TrendyolImportDebugRecord[];
}

export interface TrendyolImportPlatformJob {
  /** Codul storefront Trendyol (ex. 'RO', 'GR', 'BG'). */
  storeFrontCode: string;
  /** Codul marketplace din platformă (ex. 'trendyol-ro', 'trendyol-gr'). */
  platform: string;
  totalPages: number;
  currency: string;
}

export interface TrendyolImportJobData {
  jobId: string;
  pluginId: string;
  platformJobs: TrendyolImportPlatformJob[];
  /**
   * When true (Trendyol "Easy Cross Country" enabled), non-RO storefront
   * listings are marked read-only because they mirror the RO origin country.
   */
  easyCrossCountry?: boolean;
}

export interface TrendyolPreviewItem {
  raw: unknown;
  mapped: {
    sku: string;
    name: string;
    priceAmountMinor: string;
    priceCurrency: string;
    stockQuantity: number;
    brand: string | null;
    ean: string | null;
    vatRate: number | null;
    imagesCount: number;
  };
  existing: {
    id: string;
    sku: string;
    name: string;
  } | null;
  action: 'link_to_existing' | 'no_match';
}

export interface TrendyolPreviewResult {
  totalElements: number;
  items: TrendyolPreviewItem[];
}
