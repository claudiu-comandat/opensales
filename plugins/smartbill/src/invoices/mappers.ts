import { z } from 'zod';

import type { OrderInvoiceInput } from '@opensales/plugin-sdk';

import type {
  SmartBillClientInfo,
  SmartBillEmitInput,
  SmartBillEmitResponse,
  SmartBillProduct,
  SmartBillStandardResponse,
} from '../client.js';

/**
 * Zod schema permisivă pentru ce returnează `ctx.api.orders.get(id)`.
 * Acceptă bigint, number sau string pentru câmpurile monetare (cross-boundary
 * serialization poate transforma bigint → string).
 */
const amountSchema = z.union([
  z.bigint(),
  z.number().int().nonnegative(),
  z.string().regex(/^\d+$/),
]);

const addressSchema = z
  .object({
    name: z.string().optional(),
    street: z.string().optional(),
    street2: z.string().optional(),
    city: z.string().optional(),
    county: z.string().optional(),
    country: z.string().optional(),
    zip: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    company: z.string().optional(),
    vat_id: z.string().optional(),
  })
  .passthrough();

const orderItemSchema = z
  .object({
    sku: z.string(),
    name: z.string(),
    quantity: z.number().int().min(1),
    unitPriceAmountMinor: amountSchema,
    unitPriceCurrency: z.string().length(3),
    attributes: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const orderWithItemsSchema = z
  .object({
    id: z.string(),
    externalId: z.string().optional(),
    totalAmountMinor: amountSchema,
    totalCurrency: z.string().length(3),
    customerEmail: z.string().nullable().optional(),
    customerPhone: z.string().nullable().optional(),
    customerName: z.string().nullable().optional(),
    billingAddress: addressSchema.optional(),
    shippingAddress: addressSchema.optional(),
    pluginId: z.string().optional(),
    shippingCostMinor: amountSchema.optional(),
    vouchersMinor: amountSchema.optional(),
    marketplaceInvoiceSeries: z.string().nullable().optional(),
    marketplace: z.string().nullable().optional(),
    deliveryMode: z.string().nullable().optional(),
    items: z.array(orderItemSchema).min(1),
  })
  .passthrough();

export type OrderWithItems = z.infer<typeof orderWithItemsSchema>;

/**
 * Configurare la nivel de mapper. Toate câmpurile sunt opționale și completează
 * payload-ul SmartBill atunci când nu vin din order.
 */
export interface BuildSmartBillEmitInputOptions {
  /** Serie facturi (ex. FCT). Trebuie să existe deja în contul Cloud. */
  defaultSeriesName?: string | undefined;
  /** Limbă document (default RO). */
  language?: string | undefined;
  /** Operează stocul la emitere. */
  useStock?: boolean | undefined;
  /** Salvează clientul în nomenclatorul SmartBill. */
  saveClientToDb?: boolean | undefined;
  /** Numele cotei TVA în nomenclatorul SmartBill (default 'Normala'). */
  defaultTaxName?: string | undefined;
  /** Procentul cotei TVA per linie (default 19). */
  defaultTaxPercentage?: number | undefined;
  /** Unitate de măsură default (default 'buc'). */
  defaultMeasuringUnit?: string | undefined;
}

const DEFAULT_TAX_NAME = 'Normala';
const DEFAULT_TAX_PERCENTAGE = 19;
const DEFAULT_UM = 'buc';

/**
 * Construiește payload-ul pentru POST /invoice din `Order + items`.
 *
 * Reguli de mapare:
 *   - `currency` ← `totalCurrency` (uppercase)
 *   - `client` ← detectat din `billingAddress` și `customerName`:
 *       * `isTaxPayer=true` + `vatCode` dacă există `vat_id` (CUI client → PJ)
 *       * `name` ← `company` pentru PJ, altfel `customerName`/`billing.name`
 *   - `products[]` ← `items[]`:
 *       * `quantity` = `quantity`
 *       * `price` = `unitPriceAmountMinor / 100` (major units)
 *       * `taxName`/`taxPercentage` din opțiuni (combinația trebuie definită în Cloud)
 *       * `isTaxIncluded` = true (prețurile din OpenSales includ TVA)
 *   - linie de transport sintetică din `shippingCostMinor` (dacă > 0 și fără item TRANSPORT)
 */
export function buildSmartBillEmitInput(
  order: OrderWithItems,
  options: BuildSmartBillEmitInputOptions = {},
): SmartBillEmitInput {
  const isPickup = order.deliveryMode === 'pickup';
  const client = buildClientInfo(order, options);

  const itemsForInvoice = isPickup
    ? order.items.filter((it) => it.sku !== 'TRANSPORT')
    : order.items;
  const products = itemsForInvoice.map((it) => buildProduct(it, options));

  const hasTransportItem = order.items.some((it) => it.sku === 'TRANSPORT');
  if (
    !isPickup &&
    !hasTransportItem &&
    order.shippingCostMinor !== null &&
    order.shippingCostMinor !== undefined &&
    minorToMajor(order.shippingCostMinor) > 0
  ) {
    products.push({
      name: 'Transport',
      code: 'TRANSPORT',
      measuringUnitName: options.defaultMeasuringUnit ?? DEFAULT_UM,
      currency: order.totalCurrency.toUpperCase(),
      quantity: 1,
      price: minorToMajor(order.shippingCostMinor),
      isTaxIncluded: true,
      taxName: options.defaultTaxName ?? DEFAULT_TAX_NAME,
      taxPercentage: options.defaultTaxPercentage ?? DEFAULT_TAX_PERCENTAGE,
      isService: true,
    });
  }

  const input: SmartBillEmitInput = {
    client,
    currency: order.totalCurrency.toUpperCase(),
    products,
  };
  if (options.defaultSeriesName) input.seriesName = options.defaultSeriesName;
  if (options.language) input.language = options.language;
  if (options.useStock !== undefined) input.useStock = options.useStock;

  // Mențiuni: "ID_COMANDA - MARKETPLACE" pentru trasabilitate.
  if (order.externalId && order.marketplace) {
    input.mentions = `${order.externalId} - ${order.marketplace.toUpperCase()}`;
  }

  return input;
}

function buildClientInfo(
  order: OrderWithItems,
  options: BuildSmartBillEmitInputOptions,
): SmartBillClientInfo {
  const billing = order.billingAddress ?? {};
  const hasVat = Boolean(billing.vat_id);
  const name = (hasVat ? billing.company : (order.customerName ?? billing.name)) ?? '';

  const info: SmartBillClientInfo = {
    name,
    isTaxPayer: hasVat,
  };
  if (billing.vat_id) info.vatCode = billing.vat_id;
  const email = order.customerEmail ?? billing.email;
  if (email) info.email = email;
  const phone = order.customerPhone ?? billing.phone;
  if (phone) info.phone = phone;
  if (billing.city) info.city = billing.city;
  if (billing.county) info.county = billing.county;
  if (billing.country) info.country = billing.country;
  const address = [billing.street, billing.street2, billing.zip].filter(Boolean).join(', ');
  if (address) info.address = address;
  if (options.saveClientToDb !== undefined) info.saveToDb = options.saveClientToDb;
  return info;
}

function buildProduct(
  item: OrderWithItems['items'][number],
  options: BuildSmartBillEmitInputOptions,
): SmartBillProduct {
  const attrs = item.attributes ?? {};
  const umRaw = attrs.um;
  const um = typeof umRaw === 'string' ? umRaw : (options.defaultMeasuringUnit ?? DEFAULT_UM);
  return {
    name: item.name,
    code: item.sku,
    measuringUnitName: um,
    currency: item.unitPriceCurrency.toUpperCase(),
    quantity: item.quantity,
    price: minorToMajor(item.unitPriceAmountMinor),
    isTaxIncluded: true,
    taxName: options.defaultTaxName ?? DEFAULT_TAX_NAME,
    taxPercentage: options.defaultTaxPercentage ?? DEFAULT_TAX_PERCENTAGE,
  };
}

/**
 * Convertor amount_minor → unit decimal (major).
 * Acceptă bigint, number sau string (pentru cross-process serialization).
 */
export function minorToMajor(value: bigint | number | string): number {
  if (typeof value === 'bigint') return Number(value) / 100;
  if (typeof value === 'number') return value / 100;
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Mapează răspunsul SmartBill la formatul OrderInvoiceInput (camelCase). */
export function fromSmartBillEmitResponse(
  res: SmartBillEmitResponse,
  issuedAt: Date = new Date(),
): OrderInvoiceInput {
  const out: OrderInvoiceInput = {
    series: res.series,
    number: res.number,
    status: 'issued',
    issuedAt: issuedAt.toISOString(),
  };
  if (res.url) out.pdfUrl = res.url;
  return out;
}

/** Construiește OrderInvoiceInput pentru factura storno emisă. */
export function toStornoInvoice(
  series: string,
  number: string,
  res: SmartBillStandardResponse,
  issuedAt: Date = new Date(),
): OrderInvoiceInput {
  const out: OrderInvoiceInput = {
    series,
    number,
    status: 'issued',
    issuedAt: issuedAt.toISOString(),
  };
  if (typeof res.url === 'string' && res.url) out.pdfUrl = res.url;
  return out;
}

/** Marchează factura existentă ca anulată — păstrează series/number/pdfUrl. */
export function toCancelledInvoice(existing: OrderInvoiceInput): OrderInvoiceInput {
  const out: OrderInvoiceInput = {
    series: existing.series,
    number: existing.number,
    status: 'cancelled',
    issuedAt: existing.issuedAt,
  };
  if (existing.pdfUrl !== undefined) out.pdfUrl = existing.pdfUrl;
  return out;
}

/** Marchează factura existentă ca emisă (restore). */
export function toIssuedInvoice(existing: OrderInvoiceInput): OrderInvoiceInput {
  const out: OrderInvoiceInput = {
    series: existing.series,
    number: existing.number,
    status: 'issued',
    issuedAt: existing.issuedAt,
  };
  if (existing.pdfUrl !== undefined) out.pdfUrl = existing.pdfUrl;
  return out;
}
