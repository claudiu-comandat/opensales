/**
 * Strongly-typed payloads for platform events emitted via PluginEventsBus.
 * Event names are listed in `@opensales/plugin-sdk` `PLATFORM_EVENTS`.
 */

export interface ProductCreatedPayload {
  productId: string;
  sku: string;
}
export interface ProductUpdatedPayload {
  productId: string;
  changes: string[];
}
export interface ProductDeletedPayload {
  productId: string;
  sku: string;
}

export type StockChangeReason = 'order' | 'manual' | 'cancel' | 'plugin';
export interface StockChangedPayload {
  productId: string;
  quantityBefore: number;
  quantityAfter: number;
  reason: StockChangeReason;
}

export interface ListingCreatedPayload {
  listingId: string;
}
export interface ListingUpdatedPayload {
  listingId: string;
  changes: string[];
}
export interface ListingDeletedPayload {
  listingId: string;
}

export interface OrderCreatedPayload {
  orderId: string;
  externalId: string;
  pluginId: string | null;
}
export interface OrderStatusChangedPayload {
  orderId: string;
  statusBefore: string;
  statusAfter: string;
}
export interface OrderCancelledPayload {
  orderId: string;
}

export interface AwbIssuedPayload {
  orderId: string;
  awb: unknown;
}

export interface InvoiceIssuedPayload {
  orderId: string;
  invoice: unknown;
}

/**
 * Mapping from platform event name → payload type.
 * Useful for type-level assertions.
 */
export interface PlatformEventPayloads {
  'product.created': ProductCreatedPayload;
  'product.updated': ProductUpdatedPayload;
  'product.deleted': ProductDeletedPayload;
  'stock.changed': StockChangedPayload;
  'listing.created': ListingCreatedPayload;
  'listing.updated': ListingUpdatedPayload;
  'listing.deleted': ListingDeletedPayload;
  'order.created': OrderCreatedPayload;
  'order.status_changed': OrderStatusChangedPayload;
  'order.cancelled': OrderCancelledPayload;
  'awb.outgoing.issued': AwbIssuedPayload;
  'awb.return.issued': AwbIssuedPayload;
  'invoice.issued': InvoiceIssuedPayload;
  'invoice.storno.issued': InvoiceIssuedPayload;
}
