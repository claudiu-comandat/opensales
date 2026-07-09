export interface TemuImportJobData {
  jobId: string;
  pluginId: string;
  totalPages: number;
  currency: string;
  platform: string; // e.g. 'temu-eu'
}

export type TemuImportStatus = 'queued' | 'running' | 'done' | 'error';

export interface TemuImportError {
  goods_id: number | null;
  message: string;
}

export interface TemuImportProgress {
  jobId: string;
  status: TemuImportStatus;
  currentPage: number;
  totalPages: number;
  productsImported: number;
  listingsImported: number;
  skipped: number;
  errors: TemuImportError[];
  startedAt: string;
  finishedAt?: string;
}

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
