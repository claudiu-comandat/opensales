import { z } from 'zod';

import { TRENDYOL_STOREFRONTS, type TrendyolStoreFrontCode } from '../config.js';

/**
 * Storefront opțional per-apel. Fără el, plugin-ul folosește storefront-ul
 * implicit din secrets. Cu el, rutează requestul către storefront-ul cerut
 * folosind aceleași credențiale.
 */
export const storeFrontCodeSchema = z.enum(
  Object.keys(TRENDYOL_STOREFRONTS) as [TrendyolStoreFrontCode, ...TrendyolStoreFrontCode[]],
);

// ─── createProduct / updateProduct ───────────────────────────────────────────

export const ProductItemSchema = z.object({
  barcode: z.string().min(1).max(40),
  stockCode: z.string().min(1).max(100),
  title: z.string().min(1).max(100),
  productMainId: z.string().min(1),
  brandId: z.number().int(),
  categoryId: z.number().int(),
  listPrice: z.number().positive(),
  salePrice: z.number().positive(),
  vatRate: z.number().int().min(0),
  quantity: z.number().int().min(0),
  images: z.array(z.object({ url: z.string().url() })).min(1),
  attributes: z.array(
    z.object({
      attributeId: z.number().int(),
      attributeValueId: z.number().int().optional(),
      customAttributeValue: z.string().optional(),
    }),
  ),
  description: z.string().optional(),
  deliveryDuration: z.number().int().optional(),
  fastDeliveryType: z.string().optional(),
});

export type ProductItem = z.infer<typeof ProductItemSchema>;

export const CreateProductInputSchema = z.object({
  items: z.array(ProductItemSchema).min(1).max(1000),
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

export const BatchRequestOutputSchema = z.object({
  batchRequestId: z.string(),
});

export type BatchRequestOutput = z.infer<typeof BatchRequestOutputSchema>;

// ─── updateApprovedContent (content-bulk-update) ──────────────────────────────

/**
 * Content-only update pentru produse APROBATE (content-bulk-update). Identificarea
 * se face prin `contentId` (NU barcode). Partial update e permis pentru
 * title/description/images; pentru `attributes` Trendyol cere TOATE atributele
 * dacă trimiți măcar unul — de aceea îl ținem opțional și îl includem doar când
 * avem setul complet. Stocul NU se poate trimite aici (doar prin price-and-inventory).
 */
export const ContentUpdateItemSchema = z.object({
  contentId: z.number().int(),
  title: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  images: z
    .array(z.object({ url: z.string().url() }))
    .min(1)
    .optional(),
  attributes: z
    .array(
      z.object({
        attributeId: z.number().int(),
        attributeValueId: z.number().int().optional(),
        customAttributeValue: z.string().optional(),
      }),
    )
    .optional(),
});

export type ContentUpdateItem = z.infer<typeof ContentUpdateItemSchema>;

export const ContentBulkUpdateInputSchema = z.object({
  items: z.array(ContentUpdateItemSchema).min(1).max(1000),
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type ContentBulkUpdateInput = z.infer<typeof ContentBulkUpdateInputSchema>;

// ─── filterProducts ───────────────────────────────────────────────────────────

export const FilterProductsInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  // Trendyol V2 products/approved allows up to size=100 (page*size must stay ≤ 10000).
  size: z.number().int().min(1).max(100).default(100),
  barcode: z.string().optional(),
  stockCode: z.string().optional(),
  productMainId: z.string().optional(),
  approved: z.boolean().optional(),
  archived: z.boolean().optional(),
  blacklisted: z.boolean().optional(),
  /**
   * Cursor de paginare V2 — când e prezent, API-ul ignoră `page` și întoarce
   * pagina următoare. Obligatoriu pentru cataloage > 10.000 (unde `page*size`
   * ar depăși limita). Îl propagăm din `nextPageToken`-ul răspunsului anterior.
   */
  nextPageToken: z.string().optional(),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type FilterProductsInput = z.infer<typeof FilterProductsInputSchema>;

export const FilterProductsOutputSchema = z.object({
  page: z.number(),
  size: z.number(),
  totalElements: z.number(),
  totalPages: z.number(),
  content: z.array(z.record(z.unknown())),
  /** Cursor către pagina următoare; absent/null pe ultima pagină. */
  nextPageToken: z.string().nullable().optional(),
});

export type FilterProductsOutput = z.infer<typeof FilterProductsOutputSchema>;

// ─── updateStockAndPrice ──────────────────────────────────────────────────────

export const StockPriceItemSchema = z.object({
  barcode: z.string().min(1),
  salePrice: z.number().positive().optional(),
  listPrice: z.number().positive().optional(),
  quantity: z.number().int().min(0).optional(),
  /** TVA — cerut de unele storefront-uri (ex. GR) la update de preț/stoc. */
  vatRate: z.number().int().min(0).optional(),
});

export const UpdateStockAndPriceInputSchema = z.object({
  items: z.array(StockPriceItemSchema).min(1),
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type UpdateStockAndPriceInput = z.infer<typeof UpdateStockAndPriceInputSchema>;

// ─── archiveProducts (activ/pasiv) ────────────────────────────────────────────

export const ArchiveItemSchema = z.object({
  barcode: z.string().min(1),
  archived: z.boolean(),
});

export const ArchiveProductsInputSchema = z.object({
  items: z.array(ArchiveItemSchema).min(1).max(1000),
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type ArchiveProductsInput = z.infer<typeof ArchiveProductsInputSchema>;

// ─── checkBatchRequest ────────────────────────────────────────────────────────

export const CheckBatchRequestInputSchema = z.object({
  batchRequestId: z.string().min(1),
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type CheckBatchRequestInput = z.infer<typeof CheckBatchRequestInputSchema>;

export const CheckBatchRequestOutputSchema = z.object({
  batchRequestId: z.string(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']),
  itemCount: z.number(),
  failedItemCount: z.number(),
  items: z.array(z.record(z.unknown())).optional(),
});

export type CheckBatchRequestOutput = z.infer<typeof CheckBatchRequestOutputSchema>;
