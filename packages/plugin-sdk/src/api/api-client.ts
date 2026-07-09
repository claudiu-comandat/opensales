import {
  type ListingUpsertInput,
  type ListingUpsertOutput,
  type OrderAwbInput,
  type OrderInvoiceInput,
  type OrderListInput,
  type OrderListOutput,
  type ProductListInput,
  type ProductListItem,
  type ProductListOutput,
  type ProductUpdateInput,
  type StockAdjustInput,
  type StockAdjustOutput,
} from './api-types.js';

/**
 * Typed in-process API client exposed to plugins via `PluginContext.api`.
 *
 * Each method routes through the platform's Permission Gateway, which
 * enforces the plugin's granted permissions before dispatching to the
 * underlying domain handler.
 */
export interface SdkApiClient {
  products: SdkProductsApi;
  stock: SdkStockApi;
  listings: SdkListingsApi;
  orders: SdkOrdersApi;
}

export interface SdkProductsApi {
  list(input: ProductListInput): Promise<ProductListOutput>;
  get(id: string): Promise<ProductListItem | null>;
  update(id: string, partial: ProductUpdateInput): Promise<ProductListItem>;
}

export interface SdkStockApi {
  adjust(input: StockAdjustInput): Promise<StockAdjustOutput>;
}

export interface SdkListingsApi {
  upsert(input: ListingUpsertInput): Promise<ListingUpsertOutput>;
}

export interface SdkOrdersApi {
  list(input: OrderListInput): Promise<OrderListOutput>;
  get(id: string): Promise<unknown>;
  updateStatus(id: string, status: string): Promise<void>;
  updateAwbOutgoing(id: string, awb: OrderAwbInput): Promise<void>;
  updateAwbReturn(id: string, awb: OrderAwbInput): Promise<void>;
  updateInvoice(id: string, invoice: OrderInvoiceInput): Promise<void>;
  updateInvoiceStorno(id: string, invoice: OrderInvoiceInput): Promise<void>;
}

/**
 * Canonical gateway keys used by `SdkApiClient` implementations.
 * Domain modules register handlers under these keys.
 */
export const SDK_API_GATEWAY_KEYS = {
  products: {
    list: 'products.list',
    get: 'products.get',
    update: 'products.update',
  },
  stock: {
    adjust: 'stock.adjust',
  },
  listings: {
    upsert: 'listings.upsert',
  },
  orders: {
    list: 'orders.list',
    get: 'orders.get',
    updateStatus: 'orders.updateStatus',
    updateAwbOutgoing: 'orders.updateAwbOutgoing',
    updateAwbReturn: 'orders.updateAwbReturn',
    updateInvoice: 'orders.updateInvoice',
    updateInvoiceStorno: 'orders.updateInvoiceStorno',
  },
} as const;
