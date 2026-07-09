/**
 * Shared DTO types for the typed `sdk.api` client.
 *
 * These mirror (in simplified form) the shapes that domain modules use,
 * so plugins can import types from the SDK without reaching into apps/api.
 */

export interface Money {
  amountMinor: bigint;
  currency: string;
}

export interface ProductListInput {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
}

export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  price: Money;
  stockQuantity: number;
  isActive: boolean;
}

export interface ProductListOutput {
  data: ProductListItem[];
  total: number;
}

export interface ProductImage {
  url: string;
  alt?: string;
}

export type ProductUpdateInput = Partial<{
  name: string;
  description: string | null;
  priceAmountMinor: bigint;
  priceCurrency: string;
  isActive: boolean;
  attributes: Record<string, unknown>;
  images: ProductImage[];
}>;

export interface StockAdjustInput {
  productId: string;
  delta: number;
  reason?: string;
}

export interface StockAdjustOutput {
  productId: string;
  stockQuantity: number;
}

export interface OrderListInput {
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface OrderListOutput {
  data: unknown[];
  total: number;
}

export type OrderAwbStatus =
  | 'pending'
  | 'issued'
  | 'in_transit'
  | 'delivered'
  | 'returned'
  | 'cancelled';

export interface OrderAwbInput {
  number: string;
  tracking?: string;
  carrierPluginId: string;
  pdfUrl?: string;
  status: OrderAwbStatus;
  issuedAt: string;
}

export type OrderInvoiceStatus = 'draft' | 'issued' | 'cancelled';

export interface OrderInvoiceInput {
  series: string;
  number: string;
  pdfUrl?: string;
  status: OrderInvoiceStatus;
  issuedAt: string;
}

export type ListingStatus = 'draft' | 'active' | 'paused' | 'error';

export interface ListingUpsertInput {
  productId: string;
  externalListingId: string;
  status?: ListingStatus;
  syncState?: Record<string, unknown>;
}

export interface ListingUpsertOutput {
  id: string;
}
