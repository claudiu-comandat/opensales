import { z } from 'zod';

import type { OrderInvoiceInput } from '@opensales/plugin-sdk';

import type { FgoClientInfo, FgoEmitInput, FgoEmitResponse, FgoLineItem } from '../client.js';

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
    /** Cod marketplace sursă — ex. 'emag-ro', 'trendyol-gr'. Null pentru comenzi manuale. */
    marketplace: z.string().nullable().optional(),
    /** Modul de livrare: 'courier' sau 'pickup'. Null pentru comenzi non-eMag. */
    deliveryMode: z.string().nullable().optional(),
    items: z.array(orderItemSchema).min(1),
  })
  .passthrough();

export type OrderWithItems = z.infer<typeof orderWithItemsSchema>;

/**
 * Configurare la nivel de mapper. Câmpurile sunt opționale și completează
 * payload-ul FGO atunci când nu vin din order.
 */
export interface BuildFgoEmitInputOptions {
  /** PlatformaUrl trimis către FGO (anti-fraudă, opțional). */
  platformUrl?: string | undefined;
  /** Serie facturi (ex. BV). Dacă lipsește, FGO folosește serie default cont. */
  defaultSerie?: string | undefined;
  /** Verificare duplicat la FGO (recomandat: true). */
  verificareDuplicat?: boolean | undefined;
  /** Cota TVA default per linie dacă nu vine din item.attributes.vatRate. */
  defaultVatRate?: number | undefined;
  /** Unitate de măsură default (default 'BUC'). */
  defaultUm?: string | undefined;
  /** Tip factură din nomenclatorul FGO (default 'Normala'). */
  defaultTipFactura?: string | undefined;
}

const DEFAULT_VAT = 0;
const DEFAULT_UM = 'BUC';

/**
 * Construiește payload-ul pentru POST /factura/emitere din `Order + items`.
 *
 * Reguli de mapare:
 *   - `Valuta` ← `totalCurrency` (uppercase)
 *   - `Client` ← detectat din `billingAddress` și `customerName`:
 *       * Tip = 'PJ' dacă există `vat_id` (CUI client)
 *       * Tip = 'PF' altfel (persoană fizică — `company` singur nu determină PJ)
 *       * `CodUnic` ← `vat_id` (CUI sau CNP)
 *       * `Strain` = true dacă `country` ≠ 'RO'
 *   - `Continut[]` ← `items[]`:
 *       * `NrProduse` = `quantity`
 *       * `PretUnitar` = `unitPriceAmountMinor / 100` (RON major units)
 *       * `CotaTVA` = `attributes.vatRate` SAU `defaultVatRate` SAU 19
 *       * `UM` = `attributes.um` SAU `defaultUm` SAU 'BUC'
 */
export function buildFgoEmitInput(
  order: OrderWithItems,
  options: BuildFgoEmitInputOptions = {},
): FgoEmitInput {
  const isPickup = order.deliveryMode === 'pickup';
  const client = buildClientInfo(order);
  // Pickup (locker/easybox): transportul e al eMAG, nu apare pe factură.
  const itemsForInvoice = isPickup
    ? order.items.filter((it) => it.sku !== 'TRANSPORT')
    : order.items;
  const continut = itemsForInvoice.map((it) => buildLineItem(it, options));

  // Skip synthetic transport line if an item with sku TRANSPORT already exists
  // (e.g. eMAG sends shipping as an order item AND sets shippingCostMinor).
  // Also skip entirely for pickup orders.
  const hasTransportItem = order.items.some((it) => it.sku === 'TRANSPORT');
  if (
    !isPickup &&
    !hasTransportItem &&
    order.shippingCostMinor !== null &&
    order.shippingCostMinor !== undefined &&
    minorToMajor(order.shippingCostMinor) > 0
  ) {
    continut.push({
      Denumire: 'Transport',
      NrProduse: 1,
      UM: options.defaultUm ?? DEFAULT_UM,
      CotaTVA: DEFAULT_VAT,
      PretUnitar: minorToMajor(order.shippingCostMinor),
      CodArticol: 'TRANSPORT',
    });
  }

  // Adaugă linia sintetică de voucher doar dacă nu există deja iteme cu sku=VOUCHER
  // (comenzile sincronizate din eMAG au voucherele stocate ca iteme distincte în DB).
  const hasVoucherItems = order.items.some((it) => it.sku === 'VOUCHER');
  if (
    !hasVoucherItems &&
    order.vouchersMinor !== null &&
    order.vouchersMinor !== undefined &&
    minorToMajor(order.vouchersMinor) > 0
  ) {
    continut.push({
      Denumire: 'Voucher',
      NrProduse: -1,
      UM: options.defaultUm ?? DEFAULT_UM,
      CotaTVA: DEFAULT_VAT,
      PretUnitar: minorToMajor(order.vouchersMinor),
      CodArticol: 'VOUCHER',
    });
  }

  const input: FgoEmitInput = {
    Valuta: order.totalCurrency.toUpperCase(),
    TipFactura: options.defaultTipFactura ?? 'Factura',
    Client: client,
    Continut: continut,
  };
  if (options.defaultSerie) input.Serie = options.defaultSerie;
  if (options.platformUrl) input.PlatformaUrl = options.platformUrl;
  if (options.verificareDuplicat !== undefined) {
    input.VerificareDuplicat = options.verificareDuplicat;
  }

  // Text = numele/denumirea clientului (același cu Client.Denumire).
  if (client.Denumire) input.Text = client.Denumire;

  // Explicatii = "ID_COMANDA - MARKETPLACE - SKU|QTY, SKU|QTY, ..."
  // Emis doar când avem atât externalId cât și marketplace.
  if (order.externalId && order.marketplace) {
    const products = order.items.map((i) => `${i.sku}|${i.quantity}`).join(', ');
    input.Explicatii = `${order.externalId} - ${order.marketplace.toUpperCase()} - ${products}`;
  }

  return input;
}

function buildClientInfo(order: OrderWithItems): FgoClientInfo {
  const billing = order.billingAddress ?? {};
  const country = (billing.country ?? 'RO').toUpperCase();
  const hasVat = Boolean(billing.vat_id);
  const tip: 'PF' | 'PJ' = hasVat ? 'PJ' : 'PF';

  const denumire = (tip === 'PJ' ? billing.company : (order.customerName ?? billing.name)) ?? '';

  const info: FgoClientInfo = {
    Denumire: denumire,
    Tara: country,
    Tip: tip,
  };
  if (billing.vat_id) info.CodUnic = billing.vat_id;
  const email = order.customerEmail ?? billing.email;
  if (email) info.Email = email;
  const phone = order.customerPhone ?? billing.phone;
  if (phone) info.Telefon = phone;
  if (billing.county) info.Judet = billing.county;
  if (billing.city) info.Localitate = billing.city;
  const adresa = [billing.street, billing.street2, billing.zip].filter(Boolean).join(', ');
  if (adresa) info.Adresa = adresa;
  if (country !== 'RO') info.Strain = true;
  return info;
}

function buildLineItem(
  item: OrderWithItems['items'][number],
  options: BuildFgoEmitInputOptions,
): FgoLineItem {
  const attrs = item.attributes ?? {};
  const umRaw = attrs.um;
  const um = typeof umRaw === 'string' ? umRaw : (options.defaultUm ?? DEFAULT_UM);

  const pretUnitar = minorToMajor(item.unitPriceAmountMinor);
  // FGO nu acceptă PretUnitar negativ. Pentru linii de discount/voucher cu preț
  // negativ, FGO cere NrProduse negativ și PretUnitar pozitiv (Math.abs).
  const line: FgoLineItem = {
    Denumire: item.name,
    NrProduse: pretUnitar < 0 ? -item.quantity : item.quantity,
    UM: um,
    CotaTVA: DEFAULT_VAT,
    PretUnitar: Math.abs(pretUnitar),
    CodArticol: item.sku,
    Descriere: item.sku,
  };
  return line;
}

/**
 * Convertor amount_minor → unit decimal (RON major).
 * Acceptă bigint, number sau string (pentru cross-process serialization).
 */
export function minorToMajor(value: bigint | number | string): number {
  if (typeof value === 'bigint') return Number(value) / 100;
  if (typeof value === 'number') return value / 100;
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : 0;
}

/**
 * Mapează răspunsul FGO la formatul OrderInvoiceInput (SdkApiClient — camelCase).
 *
 * `pdfUrl` rămâne undefined — FGO returnează PDF-ul prin endpoint separat
 * (/factura/print), nu in răspunsul de emitere.
 */
export function fromFgoEmitResponse(
  res: FgoEmitResponse,
  issuedAt: Date = new Date(),
): OrderInvoiceInput {
  const out: OrderInvoiceInput = {
    series: res.Factura.Serie,
    number: res.Factura.Numar,
    status: 'issued',
    issuedAt: issuedAt.toISOString(),
  };
  if (res.Factura.Link) out.pdfUrl = res.Factura.Link;
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
