import { acquireCreateProductSlot } from '../rate-limiter.js';

import {
  ArchiveProductsInputSchema,
  BatchRequestOutputSchema,
  CheckBatchRequestInputSchema,
  CheckBatchRequestOutputSchema,
  ContentBulkUpdateInputSchema,
  CreateProductInputSchema,
  FilterProductsInputSchema,
  FilterProductsOutputSchema,
  UpdateStockAndPriceInputSchema,
} from './types.js';

import type { TrendyolClient } from '../client.js';

export interface ProductActionContext {
  client: TrendyolClient;
}

export const productActions = {
  createProduct: {
    description: 'Creează produse noi pe Trendyol V2 (async).',
    input: CreateProductInputSchema,
    output: BatchRequestOutputSchema,
    async handler(input: { items: unknown[] }, { client }: ProductActionContext) {
      const parsed = CreateProductInputSchema.parse(input);
      // Acquire a shared launch slot before sending — does NOT wait for any
      // prior response; multiple requests may be in flight concurrently.
      await acquireCreateProductSlot();
      return client.post<{ batchRequestId: string }>(
        `/integration/product/sellers/${client.sellerId}/v2/products`,
        { items: parsed.items },
      );
    },
  },

  updateApprovedContent: {
    description:
      'Actualizează conținutul (title/description/images/attributes) produselor APROBATE pe Trendyol V2 (content-bulk-update, async). Identificare prin contentId; stocul NU se trimite aici.',
    input: ContentBulkUpdateInputSchema,
    output: BatchRequestOutputSchema,
    async handler(input: { items: unknown[] }, { client }: ProductActionContext) {
      const parsed = ContentBulkUpdateInputSchema.parse(input);
      await acquireCreateProductSlot();
      return client.post<{ batchRequestId: string }>(
        `/integration/product/sellers/${client.sellerId}/products/content-bulk-update`,
        { items: parsed.items },
      );
    },
  },

  updateUnapprovedProduct: {
    description:
      'Actualizează produse neaprobate (pendingApproval/unapproved) pe Trendyol V2 (async). Barcode-ul identifică produsul dar nu poate fi schimbat.',
    input: CreateProductInputSchema,
    output: BatchRequestOutputSchema,
    async handler(input: { items: unknown[] }, { client }: ProductActionContext) {
      const parsed = CreateProductInputSchema.parse(input);
      await acquireCreateProductSlot();
      return client.post<{ batchRequestId: string }>(
        `/integration/product/sellers/${client.sellerId}/products/unapproved-bulk-update`,
        { items: parsed.items },
      );
    },
  },

  filterProducts: {
    description: 'Filtrează produsele din Trendyol V2.',
    input: FilterProductsInputSchema,
    output: FilterProductsOutputSchema,
    async handler(
      input: {
        page?: number;
        size?: number;
        barcode?: string;
        stockCode?: string;
        productMainId?: string;
        approved?: boolean;
        archived?: boolean;
        blacklisted?: boolean;
        nextPageToken?: string;
      },
      { client }: ProductActionContext,
    ) {
      const parsed = FilterProductsInputSchema.parse(input);
      const params = new URLSearchParams();
      params.set('size', String(parsed.size));
      // Cursor mode: when nextPageToken is present the API ignores `page`.
      if (parsed.nextPageToken) {
        params.set('nextPageToken', parsed.nextPageToken);
      } else {
        params.set('page', String(parsed.page));
      }
      if (parsed.barcode) params.set('barcode', parsed.barcode);
      if (parsed.stockCode) params.set('stockCode', parsed.stockCode);
      if (parsed.productMainId) params.set('productMainId', parsed.productMainId);

      // Trendyol V2 expune două endpoint-uri separate în loc de un singur
      // GET /v2/products (care nu există — returnează 404).
      // Rutăm în funcție de filtrul `approved`:
      //   approved === false  → /products/unapproved
      //   orice altceva       → /products/approved  (default pentru import/preview)
      const isUnapproved = parsed.approved === false;
      const base = isUnapproved
        ? `/integration/product/sellers/${client.sellerId}/products/unapproved`
        : `/integration/product/sellers/${client.sellerId}/products/approved`;

      // Filtrele de status se trimit ca `status=<value>` în V2.
      // Mapăm boolean-urile vechi la valorile acceptate de API.
      if (!isUnapproved) {
        if (parsed.archived) params.set('status', 'archived');
        else if (parsed.blacklisted) params.set('status', 'blacklisted');
      }

      const path = `${base}?${params.toString()}`;
      const result = await client.get<{
        page: number;
        size: number;
        totalElements: number;
        totalPages: number;
        content: Record<string, unknown>[];
        nextPageToken?: string | null;
      }>(path);
      return {
        page: result.page ?? parsed.page,
        size: result.size ?? parsed.size,
        totalElements: result.totalElements ?? 0,
        totalPages: result.totalPages ?? 0,
        content: result.content ?? [],
        nextPageToken: result.nextPageToken ?? null,
      };
    },
  },

  updateStockAndPrice: {
    description: 'Actualizează stoc și prețuri (fără rate limit).',
    input: UpdateStockAndPriceInputSchema,
    output: BatchRequestOutputSchema,
    async handler(input: { items: unknown[] }, { client }: ProductActionContext) {
      const parsed = UpdateStockAndPriceInputSchema.parse(input);
      return client.post<{ batchRequestId: string }>(
        `/integration/inventory/sellers/${client.sellerId}/products/price-and-inventory`,
        { items: parsed.items },
      );
    },
  },

  archiveProducts: {
    description: 'Arhivează (pasiv) sau dezarhivează (activ) produse — batch.',
    input: ArchiveProductsInputSchema,
    output: BatchRequestOutputSchema,
    async handler(input: { items: unknown[] }, { client }: ProductActionContext) {
      const parsed = ArchiveProductsInputSchema.parse(input);
      return client.put<{ batchRequestId: string }>(
        `/integration/product/sellers/${client.sellerId}/products/archive-state`,
        { items: parsed.items },
      );
    },
  },

  checkBatchRequest: {
    description: 'Verifică statusul unui batch request asincron.',
    input: CheckBatchRequestInputSchema,
    output: CheckBatchRequestOutputSchema,
    async handler(input: { batchRequestId: string }, { client }: ProductActionContext) {
      const parsed = CheckBatchRequestInputSchema.parse(input);
      return client.get<{
        batchRequestId: string;
        status: 'IN_PROGRESS' | 'COMPLETED';
        itemCount: number;
        failedItemCount: number;
        items?: Record<string, unknown>[];
      }>(
        `/integration/product/sellers/${client.sellerId}/products/batch-requests/${parsed.batchRequestId}`,
      );
    },
  },
} as const;

export type ProductActions = typeof productActions;
