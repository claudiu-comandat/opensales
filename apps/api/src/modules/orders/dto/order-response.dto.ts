import { type schema } from '@opensales/db';

export interface OrderItemSubstitution {
  originalSku: string;
  originalName: string;
  originalProductId: string | null;
  substitutedAt: string;
}

export interface OrderItemResponse {
  id: string;
  productId: string | null;
  sku: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: { amountMinor: string; currency: string };
  total: { amountMinor: string; currency: string };
  attributes: Record<string, unknown>;
  substitution: OrderItemSubstitution | null;
  /** Discount/voucher alocat direct acestei linii (eMAG product_voucher_split,
   * Trendyol lineSellerDiscount+lineTyDiscount). Null dacă linia n-a avut discount alocat. */
  voucher: { amountMinor: string; currency: string } | null;
}

/**
 * Side-channel data resolved by the service when building order items —
 * lets us enrich the item response with product image + canonical name from
 * the local products table when the item is linked via productId.
 */
export interface OrderItemEnrichment {
  productLookup?: Map<string, { name: string; imageUrl: string | null }>;
}

export interface OrderFirstItem {
  name: string;
  sku: string;
  imageUrl: string | null;
  quantity: number;
}

export interface OrderSummaryItem {
  name: string;
  sku: string;
  quantity: number;
}

/**
 * Formă SLABĂ pentru cache-ul de retururi din app-ul de depozit: doar câmpurile
 * necesare potrivirii AWB și afișării/storno-ului. Fără raw payload, adrese, imagini,
 * prețuri — vezi OrdersService.returnIndex.
 */
export interface ReturnIndexOrder {
  id: string;
  externalId: string;
  marketplace: string | null;
  status: string;
  awbNumber: string | null;
  awbReturn: { number: string } | null;
  customer: { name: string | null };
  allItems: OrderSummaryItem[];
}

export interface OrderResponse {
  id: string;
  externalId: string;
  pluginId: string | null;
  /** Codul marketplace sursă (ex. 'emag-ro', 'trendyol-gr'). Null pentru comenzi manuale. */
  marketplace: string | null;
  /** Modul de livrare: 'courier' sau 'pickup'. Null pentru comenzi non-eMag. */
  deliveryMode: string | null;
  /** Data la care clientul a solicitat anularea comenzii. Null dacă nu s-a cerut anulare. */
  cancellationRequest: string | null;
  status: string;
  total: { amountMinor: string; currency: string };
  shippingCost: { amountMinor: string; currency: string } | null;
  tax: { amountMinor: string; currency: string } | null;
  vouchers: { amountMinor: string; currency: string } | null;
  paymentStatus: string | null;
  refundedAmount: { amountMinor: string; currency: string } | null;
  deliveryLocation: {
    name?: string | undefined;
    type?: string | undefined;
    courier_name?: string | undefined;
  } | null;
  finalizedAt: string | null;
  attachments: { name: string; url: string; type?: number | undefined }[] | null;
  customer: { email: string | null; phone: string | null; name: string | null };
  billingAddress: Record<string, unknown>;
  shippingAddress: Record<string, unknown>;
  awbOutgoing: unknown;
  awbReturn: unknown;
  awbNumber: string | null;
  awbTrackingUrl: string | null;
  /** true când comanda are cargoTrackingNumber de la Trendyol (Trendyol Pays) → PDF disponibil. */
  awbHasTrendyolLabel: boolean;
  /** true când comanda are emag_id stocat pe AWB → PDF disponibil via awb/read_pdf. */
  awbHasEmagLabel: boolean;
  invoice: unknown;
  invoiceStorno: unknown;
  invoiceSeries: string | null;
  invoiceStornoSeries: string | null;
  invoicePdfUrl: string | null;
  placedAt: string;
  createdAt: string;
  updatedAt: string;
  items?: OrderItemResponse[] | undefined;
  firstItem?: OrderFirstItem | undefined;
  allItems?: OrderSummaryItem[] | undefined;
  /** true când comanda are minim un produs neidentificat (productId=null, nu linie virtuală). */
  hasUnmatchedItems: boolean;
  /** Payload-ul brut primit de la marketplace la sync. Null pentru comenzi manuale. */
  rawPayload: unknown;
  /** payment_mode_id din rawPayload: 1=Ramburs, 2=Transfer Bancar, 3=Card Online. */
  paymentModeId: number | null;
}

export interface OrderResponseOptions {
  /** Când false, rawPayload e omis din răspuns (folosit pentru apeluri externe prin API key). */
  includeRawPayload?: boolean;
  /** true când cel puțin un item (non-virtual) are productId=null. */
  hasUnmatchedItems?: boolean;
}

export function toOrderResponse(
  o: schema.Order,
  items?: schema.OrderItem[],
  enrichment?: OrderItemEnrichment,
  firstItem?: OrderFirstItem,
  allItems?: OrderSummaryItem[],
  options?: OrderResponseOptions,
): OrderResponse {
  const cur = o.totalCurrency;
  return {
    id: o.id,
    externalId: o.externalId,
    pluginId: o.pluginId,
    marketplace: o.marketplace ?? null,
    deliveryMode: o.deliveryMode ?? null,
    cancellationRequest: o.cancellationRequest ?? null,
    status: o.status,
    total: { amountMinor: o.totalAmountMinor.toString(), currency: cur },
    shippingCost:
      o.shippingCostMinor !== null
        ? { amountMinor: o.shippingCostMinor.toString(), currency: cur }
        : null,
    tax: o.taxMinor !== null ? { amountMinor: o.taxMinor.toString(), currency: cur } : null,
    vouchers:
      o.vouchersMinor !== null ? { amountMinor: o.vouchersMinor.toString(), currency: cur } : null,
    paymentStatus: o.paymentStatus ?? null,
    refundedAmount:
      o.refundedAmountMinor !== null
        ? { amountMinor: o.refundedAmountMinor.toString(), currency: cur }
        : null,
    deliveryLocation: o.deliveryLocation ?? null,
    finalizedAt: o.finalizedAt ? o.finalizedAt.toISOString() : null,
    attachments: o.attachments ?? null,
    customer: {
      email: o.customerEmail ?? null,
      phone: o.customerPhone ?? null,
      name: o.customerName ?? null,
    },
    billingAddress: o.billingAddress as Record<string, unknown>,
    shippingAddress: o.shippingAddress as Record<string, unknown>,
    awbOutgoing: o.awbOutgoing,
    awbReturn: o.awbReturn,
    awbNumber: o.awbOutgoing?.number ?? null,
    awbTrackingUrl: o.awbOutgoing?.tracking_url ?? null,
    awbHasTrendyolLabel:
      typeof o.awbOutgoing?.trendyol_tracking_number === 'string' &&
      !!o.awbOutgoing.trendyol_tracking_number,
    awbHasEmagLabel: typeof o.awbOutgoing?.emag_id === 'number' && o.awbOutgoing.emag_id > 0,
    invoice: o.invoice,
    invoiceStorno: o.invoiceStorno,
    // Combine series + number when both are present (platform-created invoices store them separately).
    // eMAG-imported invoices store the full reference (e.g. "E 5245") in number with series=''.
    invoiceSeries: o.invoice
      ? o.invoice.series && o.invoice.number
        ? `${o.invoice.series} ${o.invoice.number}`
        : o.invoice.number || o.invoice.series || 'issued'
      : null,
    invoiceStornoSeries: o.invoiceStorno
      ? o.invoiceStorno.series && o.invoiceStorno.number
        ? `${o.invoiceStorno.series} ${o.invoiceStorno.number}`
        : o.invoiceStorno.number || o.invoiceStorno.series || 'storno'
      : null,
    invoicePdfUrl: o.invoice?.pdf_url ?? null,
    placedAt: o.placedAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items: items?.map((i) => toItemResponse(i, enrichment)),
    firstItem: firstItem,
    allItems,
    hasUnmatchedItems:
      options?.hasUnmatchedItems ??
      (items !== undefined
        ? items.some((i) => i.productId === null && i.sku !== 'TRANSPORT' && i.sku !== 'VOUCHER')
        : false),
    rawPayload: (options?.includeRawPayload ?? true) ? (o.rawPayload ?? null) : undefined,
    paymentModeId: (() => {
      const raw = o.rawPayload as Record<string, unknown> | null;
      const id = raw?.payment_mode_id;
      return typeof id === 'number' ? id : null;
    })(),
  };
}

export function toItemResponse(
  i: schema.OrderItem,
  enrichment?: OrderItemEnrichment,
): OrderItemResponse {
  const product = i.productId ? enrichment?.productLookup?.get(i.productId) : undefined;
  return {
    id: i.id,
    productId: i.productId ?? null,
    sku: i.sku,
    // Prefer canonical product name from local DB when item is linked — eMAG
    // sometimes omits product_name in order/read, leaving us with just the SKU.
    name: product?.name ?? i.name,
    imageUrl: product?.imageUrl ?? null,
    quantity: i.quantity,
    unitPrice: { amountMinor: i.unitPriceAmountMinor.toString(), currency: i.unitPriceCurrency },
    total: { amountMinor: i.totalAmountMinor.toString(), currency: i.unitPriceCurrency },
    attributes: i.attributes,
    substitution:
      i.substitutedAt !== null && i.originalSku !== null && i.originalName !== null
        ? {
            originalSku: i.originalSku,
            originalName: i.originalName,
            originalProductId: i.originalProductId ?? null,
            substitutedAt: i.substitutedAt.toISOString(),
          }
        : null,
    voucher:
      i.voucherAmountMinor !== null
        ? { amountMinor: i.voucherAmountMinor.toString(), currency: i.unitPriceCurrency }
        : null,
  };
}
