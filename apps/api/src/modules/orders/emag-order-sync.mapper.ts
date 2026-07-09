import { v7 as uuidv7 } from 'uuid';

import type { schema } from '@opensales/db';

type OrderStatus = schema.Order['status'];
type NewOrder = schema.NewOrder;
type NewOrderItem = schema.NewOrderItem;

// eMAG status → OpenSales status
const STATUS_MAP: Record<number, OrderStatus> = {
  0: 'cancelled',
  1: 'new',
  2: 'processing',
  3: 'packed',
  4: 'shipped',
  5: 'returned',
};

/**
 * eMAG `OrderCustomer` field names follow doc § 5.1.2 — see
 * `plugins/emag/src/orders/types.ts`. The actual fields are:
 *   phone_1, phone_2, phone_3 (NOT `phone`)
 *   billing_postal_code (NOT `billing_zipcode`)
 *   billing_suburb / billing_locality_id (NOT `billing_locality`)
 *   shipping_postal_code (NOT `shipping_zipcode`)
 *   shipping_suburb (NOT `shipping_locality`)
 *   shipping_contact, shipping_phone
 *   email at the customer root (no `billing_email` / `shipping_email`)
 */
export interface EmagOrderRaw {
  id: number;
  status: number;
  /**
   * 2 = Fulfilled by eMAG (FBE/FD) — only attachment uploads allowed via API.
   * 3 = Fulfilled by seller (implicit default before Aug 2025).
   */
  type?: number;
  date?: string | number;
  customer?: {
    name?: string;
    email?: string;
    phone_1?: string;
    phone_2?: string;
    phone_3?: string;
    company?: string;
    code?: string;
    billing_name?: string;
    billing_phone?: string;
    billing_country?: string;
    billing_suburb?: string;
    billing_city?: string;
    billing_locality_id?: string;
    billing_street?: string;
    billing_postal_code?: string;
    shipping_country?: string;
    shipping_suburb?: string;
    shipping_city?: string;
    shipping_locality_id?: string;
    shipping_street?: string;
    shipping_postal_code?: string;
    shipping_contact?: string;
    shipping_phone?: string;
    [key: string]: unknown;
  };
  products?: {
    id: number;
    product_id?: number;
    quantity: number;
    sale_price: number | string;
    status?: number;
    /** Offer SKU (e.g. "B0CT4GKBQ5"). Primary lookup key. */
    part_number?: string;
    part_number_key?: string;
    /** Extended part number / canonical EAN-like code (e.g. "B0CT4GKBQ5CN"). Fallback lookup. */
    ext_part_number?: string;
    /** Human-readable product name from eMAG (e.g. "Geantă bebe organizator..."). */
    name?: string;
    product_name?: string;
    /** Original quantity before any returns. Non-zero even when quantity=0 (fully returned). */
    initial_qty?: number;
    /** Number of units returned/stornoed. */
    storno_qty?: number;
  }[];
  /** ISO timestamp of last modification (always present — used as placedAt fallback when date is null). */
  modified?: string;
  shipping_tax?: number | string;
  /** VAT amount */
  tax?: number | string;
  /** Vouchers/discount total */
  total_vouchers?: number | string;
  payment_mode?: string;
  /** 0 = unpaid / on delivery, 1 = paid online */
  payment_status?: number;
  /**
   * 1 = RAMBURS (cash on delivery), 2 = transfer bancar, 3 = card online.
   * Folosit pentru a determina dacă se aplică ramburs la emiterea AWB.
   */
  payment_mode_id?: number;
  refunded_amount?: number | string;
  refund_status?: string | null;
  /** Vouchere aplicate de eMAG. Stocate ca articole cu preț negativ pe comandă. */
  vouchers?: {
    id?: number;
    voucher_id?: number;
    voucher_name?: string;
    /** Prețul voucherului trimis de eMAG — valoare negativă (e.g. "-50.0000"). */
    sale_price?: number | string;
    /** Câmp alternativ prezent în unele versiuni API. */
    value?: number | string;
    vat?: number | string;
    status?: number;
  }[];
  /** "pickup" = locker/easybox, "courier" = home delivery */
  delivery_mode?: string;
  details?: {
    locker_id?: string;
    locker_name?: string;
    courier_name?: string;
    [key: string]: unknown;
  };
  finalization_date?: string;
  /** Data la care clientul a solicitat anularea comenzii (ex. "2026-05-27 13:15:10"). Null dacă nu s-a cerut anulare. */
  cancellation_request?: string | null;
  invoice_storno_url?: string | null;
  invoice_storno_id?: string | null;
  invoice_storno_date?: string | null;
  attachments?: {
    name?: string;
    url: string;
    /** 1 = invoice, 3 = warranty, 4 = user manual, 8 = user guide, 10 = AWB, 11 = proforma. */
    type?: number;
    order_id?: number;
    order_product_id?: number;
  }[];
  [key: string]: unknown;
}

// eMAG sends `date` as either:
//  - Unix timestamp in seconds (e.g. 1699337715) — new Date("1699337715") = Invalid Date, must *1000
//  - Naive datetime string in Romania local time (e.g. "2026-06-17 11:01:56") — NO timezone suffix.
//    new Date(naiveStr) in a UTC server stores it as UTC, frontend adds +3h EEST → shows 3h late.
//    Fix: detect the pattern and parse as Europe/Bucharest.
const EMAG_NAIVE_DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function parseDateAsBucharest(localStr: string): Date {
  // Treat the naive string as Europe/Bucharest local time and convert to UTC.
  // 1) Parse as UTC (probe) — gives us a Date object for DST lookup.
  const probeMs = Date.parse(localStr.replace(' ', 'T') + 'Z');
  if (isNaN(probeMs)) return new Date();
  const probe = new Date(probeMs);
  // 2) Format the probe in Bucharest to find what local time corresponds to that UTC moment.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(probe);
  const get = (t: string): number => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const h = get('hour');
  const tzMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    h === 24 ? 0 : h,
    get('minute'),
    get('second'),
  );
  // 3) offset = bucharestLocal(probe) - probe(UTC); actual UTC = local - offset.
  return new Date(probeMs - (tzMs - probeMs));
}

function parseEmagDate(d: string | number | undefined): Date {
  if (d === undefined || d === null) return new Date();
  const n = typeof d === 'number' ? d : parseInt(String(d), 10);
  if (!isNaN(n) && n > 1_000_000_000) return new Date(n * 1000);
  if (typeof d === 'string' && EMAG_NAIVE_DATE_RE.test(d)) return parseDateAsBucharest(d);
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function safeFloat(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function toMinor(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}

/**
 * eMAG attachment type codes (doc § 3.1.3 / § 5).
 * Used to route invoice/AWB/proforma to the right column on `orders`.
 */
const ATTACHMENT_TYPE = {
  INVOICE: 1,
  AWB: 10,
  PROFORMA: 11,
} as const;

/**
 * Returns true for invoices hosted by the vendor (fgo.ro, etc.).
 * eMAG sometimes attaches its own marketplace-generated invoice
 * (Factura_K-MKTP-*.pdf / Factura_TGSZ*.pdf hosted on marketplace.emag.ro)
 * alongside the vendor's real invoice — we always prefer ours.
 */
function isVendorHosted(url: string): boolean {
  return !url.includes('marketplace.emag.ro');
}

function extractInvoice(
  attachments: EmagOrderRaw['attachments'],
  placedAt: Date,
): schema.OrderInvoice | null {
  if (!Array.isArray(attachments)) return null;
  const type1 = attachments.filter((a) => a.type === ATTACHMENT_TYPE.INVOICE);
  const proforma = attachments.filter((a) => a.type === ATTACHMENT_TYPE.PROFORMA);
  // Only use vendor-hosted invoices (fgo.ro). Never fall back to
  // marketplace.emag.ro-hosted ones — those are eMAG's own documents.
  const invoice =
    type1.find((a) => isVendorHosted(a.url)) ?? proforma.find((a) => isVendorHosted(a.url));
  if (!invoice) return null;
  return {
    series: '',
    number: invoice.name ?? '',
    pdf_url: invoice.url,
    status: 'issued',
    issued_at: placedAt.toISOString(),
  };
}

function extractAwb(
  attachments: EmagOrderRaw['attachments'],
  placedAt: Date,
  pluginId: string,
  order?: EmagOrderRaw,
): schema.OrderAwb | null {
  if (!Array.isArray(attachments)) return null;
  const awb = attachments.find((a) => a.type === ATTACHMENT_TYPE.AWB);
  if (!awb) return null;
  const result: schema.OrderAwb = {
    number: awb.name ?? '',
    carrier_plugin_id: pluginId,
    pdf_url: awb.url,
    status: 'issued',
    issued_at: placedAt.toISOString(),
  };
  if (order?.details?.courier_name) {
    result.tracking_url = buildTrackingUrl(order.details.courier_name, result.number);
  }
  return result;
}

const CARRIER_TRACKING_URLS: Record<string, string> = {
  sameday: 'https://client.sameday.ro/en/awb-tracking/',
  cargus: 'https://www.urgentcargus.ro/tracking?awb=',
  dpd: 'https://tracking.dpd.de/status/en_US/parcel/',
  fancourier: 'https://www.fancourier.ro/awb-tracking/?awb=',
  gls: 'https://gls-group.eu/RO/en/parcel-tracking?match=',
};

function buildTrackingUrl(courierName: string, awbNumber: string): string | undefined {
  const key = courierName.toLowerCase().replace(/\s+/g, '');
  for (const [carrier, base] of Object.entries(CARRIER_TRACKING_URLS)) {
    if (key.includes(carrier)) return `${base}${awbNumber}`;
  }
  return undefined;
}

function extractDeliveryLocation(order: EmagOrderRaw): schema.OrderDeliveryLocation | null {
  const details = order.details;
  const hasLocker = order.delivery_mode === 'pickup' || details?.locker_name;
  if (!hasLocker && !details?.courier_name) return null;
  const loc: schema.OrderDeliveryLocation = {};
  if (details?.locker_name) {
    loc.name = String(details.locker_name);
    loc.type = 'locker';
  } else {
    loc.type = 'home';
  }
  if (details?.courier_name) loc.courier_name = String(details.courier_name);
  return loc;
}

function extractStornoInvoice(order: EmagOrderRaw, placedAt: Date): schema.OrderInvoice | null {
  if (!order.invoice_storno_url && !order.invoice_storno_id) return null;
  return {
    series: '',
    number: String(order.invoice_storno_id ?? ''),
    pdf_url: order.invoice_storno_url ?? undefined,
    status: 'issued',
    issued_at: order.invoice_storno_date
      ? parseEmagDate(order.invoice_storno_date).toISOString()
      : placedAt.toISOString(),
  };
}

function extractAllAttachments(attachments: EmagOrderRaw['attachments']): schema.OrderAttachment[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => a.url && isVendorHosted(a.url))
    .map((a) => ({ name: a.name ?? '', url: a.url, type: a.type }));
}

function resolveEmagStatus(emagStatus: number, placedAt: Date): OrderStatus {
  const mapped = STATUS_MAP[emagStatus] ?? 'new';
  if (mapped !== 'shipped') return mapped;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 2);
  return placedAt < cutoff ? 'delivered' : 'shipped';
}

export function mapEmagOrderToDb(
  order: EmagOrderRaw,
  pluginId: string,
  currency: string,
  /**
   * Map of SKU candidate (eMAG `part_number` / `ext_part_number` /
   * `part_number_key`) → resolved local product `{ id, sku }`.
   * The canonical `sku` from this map is used as the display SKU so the order
   * shows the seller's own SKU rather than the eMAG `part_number` placeholder.
   */
  productIdBySku = new Map<string, { id: string; sku: string }>(),
  /**
   * Codul marketplace sursă (ex. 'emag-ro', 'emag-hu'). Stocat pe comandă
   * pentru afișare per-țară în lista de comenzi.
   * Dacă order.type === 2 (FBE), codul devine 'fbe-ro', 'fbe-hu' etc.
   * (derivat din marketplace-ul contului API — emag-ro → fbe-ro).
   */
  marketplace?: string,
): { order: NewOrder; items: NewOrderItem[] } {
  // placedAt must be resolved first so resolveEmagStatus can apply the age-based delivered rule.
  const placedAt = order.date
    ? parseEmagDate(order.date)
    : order.modified
      ? parseEmagDate(order.modified)
      : new Date();
  const status = resolveEmagStatus(order.status, placedAt);

  // eMAG type 2 = Fulfilled by eMAG (FBE). Map emag-ro → fbe-ro, emag-hu → fbe-hu, etc.
  const effectiveMarketplace =
    order.type === 2 && marketplace ? marketplace.replace(/^emag-/, 'fbe-') : marketplace;

  // Keep items where the original quantity was > 0, even if quantity is now 0
  // due to a full return (storno_qty === initial_qty). This ensures returned
  // orders still show their items in the order detail view.
  const validProducts = (order.products ?? []).filter(
    (p) => p.quantity > 0 || (p.initial_qty ?? 0) > 0,
  );

  // Fully storno'd = every product was returned entirely (storno_qty === initial_qty for all).
  const isFullyStorned =
    validProducts.length > 0 &&
    validProducts.every((p) => p.quantity === 0 && (p.storno_qty ?? 0) === (p.initial_qty ?? 0));
  const itemTotal = validProducts.reduce((sum, p) => {
    return sum + safeFloat(p.sale_price) * p.quantity;
  }, 0);
  const shippingTax = safeFloat(order.shipping_tax);
  const total = itemTotal + shippingTax;

  const customer = order.customer ?? {};
  const primaryPhone = customer.phone_1 ?? customer.billing_phone ?? customer.phone_2 ?? null;
  const customerName = customer.name ?? customer.billing_name ?? customer.company ?? null;
  const customerEmail = customer.email ?? null;
  const customerPhone = primaryPhone;

  const billingAddress: schema.OrderAddress = {
    name: customer.billing_name ?? customer.name,
    street: customer.billing_street,
    city: customer.billing_city,
    county: customer.billing_suburb,
    zip: customer.billing_postal_code,
    country: customer.billing_country,
    phone: customer.billing_phone ?? primaryPhone ?? undefined,
    email: customer.email,
    company: customer.company,
    vat_id: customer.code,
  };

  const shippingLocalityId = customer.shipping_locality_id
    ? parseInt(customer.shipping_locality_id, 10)
    : customer.billing_locality_id
      ? parseInt(customer.billing_locality_id, 10)
      : undefined;

  const shippingAddress: schema.OrderAddress = {
    name: customer.shipping_contact ?? customer.name ?? customer.billing_name,
    street: customer.shipping_street ?? customer.billing_street,
    city: customer.shipping_city ?? customer.billing_city,
    county: customer.shipping_suburb ?? customer.billing_suburb,
    zip: customer.shipping_postal_code ?? customer.billing_postal_code,
    country: customer.shipping_country ?? customer.billing_country,
    phone: customer.shipping_phone ?? primaryPhone ?? undefined,
    email: customer.email,
    locality_id: shippingLocalityId && !isNaN(shippingLocalityId) ? shippingLocalityId : undefined,
  };

  const invoice = extractInvoice(order.attachments, placedAt);
  const awbOutgoing = extractAwb(order.attachments, placedAt, pluginId, order);

  const deliveryLocation = extractDeliveryLocation(order);

  const stornoInvoice = extractStornoInvoice(order, placedAt);
  const attachments = extractAllAttachments(order.attachments);

  // Suma totală a voucherelor — valoare absolută (pozitivă) pentru reconciliere și COD.
  // Preferăm suma din array-ul `vouchers` (câmpul sale_price, negativ) față de
  // `total_vouchers` care poate lipsi sau poate veni cu semn variabil.
  const voucherTotal =
    (order.vouchers?.length ?? 0) > 0
      ? (order.vouchers ?? []).reduce((s, v) => s + Math.abs(safeFloat(v.sale_price ?? v.value)), 0)
      : Math.abs(safeFloat(order.total_vouchers));

  const shippingCostMinor = toMinor(shippingTax);
  const taxMinor = toMinor(safeFloat(order.tax));
  // vouchersMinor = suma reducerilor (pozitivă) — folosită pentru afișare și audit.
  const vouchersMinor = toMinor(voucherTotal);
  const refundedAmountMinor = toMinor(safeFloat(order.refunded_amount));
  const paymentStatus =
    order.payment_status === 1 ? 'paid' : order.payment_status === 0 ? 'unpaid' : null;
  const finalizedAt = order.finalization_date ? parseEmagDate(order.finalization_date) : null;

  const newOrder: NewOrder = {
    id: uuidv7(),
    externalId: String(order.id),
    pluginId,
    status,
    // Total NET — produse + transport minus vouchere. Acesta este suma pe care
    // clientul o plătește efectiv și care apare pe factură / se colectează la livrare.
    totalAmountMinor: toMinor(total - voucherTotal),
    totalCurrency: currency,
    customerName,
    customerEmail,
    customerPhone,
    billingAddress,
    shippingAddress,
    invoice: invoice ?? null,
    invoiceStorno: stornoInvoice ?? null,
    awbOutgoing: awbOutgoing ?? null,
    shippingCostMinor,
    taxMinor,
    vouchersMinor,
    paymentStatus,
    refundedAmountMinor,
    deliveryLocation,
    finalizedAt: finalizedAt,
    attachments: attachments.length > 0 ? attachments : null,
    marketplace: effectiveMarketplace ?? null,
    deliveryMode: order.delivery_mode ?? null,
    cancellationRequest: order.cancellation_request ?? null,
    placedAt,
  };

  const items: NewOrderItem[] = [];
  for (const p of validProducts) {
    const emagSku = p.part_number ?? p.part_number_key ?? String(p.product_id ?? p.id);
    const unitPrice = safeFloat(p.sale_price);
    const resolved =
      (p.part_number ? productIdBySku.get(p.part_number) : undefined) ??
      (p.ext_part_number ? productIdBySku.get(p.ext_part_number) : undefined) ??
      (p.part_number_key ? productIdBySku.get(p.part_number_key) : undefined) ??
      null;
    const productId = resolved?.id ?? null;
    const sku = resolved?.sku ?? emagSku;
    const name = p.product_name ?? p.name ?? sku;
    // Display initial_qty (what was ordered) rather than current quantity which
    // may be 0 for fully-returned items.
    const initialQty = p.initial_qty ?? 0;
    const displayQty = initialQty > 0 ? initialQty : p.quantity;
    items.push({
      id: uuidv7(),
      orderId: newOrder.id,
      productId,
      sku,
      name,
      quantity: displayQty,
      unitPriceAmountMinor: toMinor(unitPrice),
      unitPriceCurrency: currency,
    });
    // For returned units, add a separate storno line with negative quantity so
    // the order detail shows both what was ordered and what was returned.
    const stornoQty = p.storno_qty ?? 0;
    if (stornoQty > 0) {
      items.push({
        id: uuidv7(),
        orderId: newOrder.id,
        productId,
        sku,
        name: `${name} (retur)`,
        quantity: -stornoQty,
        unitPriceAmountMinor: toMinor(unitPrice),
        unitPriceCurrency: currency,
      });
    }
  }

  // Voucherele eMAG apar ca articole cu preț negativ — reprezintă reduceri aplicate
  // de marketplace și ajută la reconcilierea corectă a totalului comenzii.
  // eMAG trimite sale_price deja negativ (e.g. "-50.0000") — îl stocăm ca atare.
  for (const v of order.vouchers ?? []) {
    const rawValue = safeFloat(v.sale_price ?? v.value);
    if (rawValue === 0) continue;
    items.push({
      id: uuidv7(),
      orderId: newOrder.id,
      productId: null,
      sku: 'VOUCHER',
      name: v.voucher_name ?? 'Voucher eMAG',
      quantity: 1,
      // sale_price vine negativ (reducere) → toMinor păstrează semnul
      unitPriceAmountMinor: toMinor(rawValue),
      unitPriceCurrency: currency,
    });
  }

  // Taxa de livrare apare ca articol separat pentru vizibilitate în comandă
  // și pe factură. Pentru pickup (locker/easybox), transportul e al eMAG —
  // nu îl includem ca item și nici pe factură.
  if (shippingTax > 0 && order.delivery_mode !== 'pickup') {
    items.push({
      id: uuidv7(),
      orderId: newOrder.id,
      productId: null,
      sku: 'TRANSPORT',
      name: 'Taxa de Livrare',
      quantity: 1,
      unitPriceAmountMinor: toMinor(shippingTax),
      unitPriceCurrency: currency,
    });
  }

  // Când comanda este complet stornată, adaugă linii de reversal pentru
  // vouchere și transport (dacă erau vizibile), astfel încât totalul net = 0.
  if (isFullyStorned) {
    for (const v of order.vouchers ?? []) {
      const rawValue = safeFloat(v.sale_price ?? v.value);
      if (rawValue === 0) continue;
      items.push({
        id: uuidv7(),
        orderId: newOrder.id,
        productId: null,
        sku: 'VOUCHER',
        name: `${v.voucher_name ?? 'Voucher eMAG'} (retur)`,
        quantity: 1,
        // Inversăm semnul: originalul era negativ (reducere), storno-ul e pozitiv
        unitPriceAmountMinor: toMinor(-rawValue),
        unitPriceCurrency: currency,
      });
    }
    if (shippingTax > 0 && order.delivery_mode !== 'pickup') {
      items.push({
        id: uuidv7(),
        orderId: newOrder.id,
        productId: null,
        sku: 'TRANSPORT',
        name: 'Taxa de Livrare (retur)',
        quantity: -1,
        unitPriceAmountMinor: toMinor(shippingTax),
        unitPriceCurrency: currency,
      });
    }
  }

  return { order: newOrder, items };
}

/**
 * Collect every SKU candidate referenced by an eMAG order — used by the sync
 * service to resolve `productIdBySku` in a single DB roundtrip per batch.
 */
export function collectSkuCandidates(order: EmagOrderRaw): string[] {
  const out: string[] = [];
  for (const p of order.products ?? []) {
    if (p.part_number) out.push(p.part_number);
    if (p.ext_part_number) out.push(p.ext_part_number);
    if (p.part_number_key) out.push(p.part_number_key);
  }
  return out;
}

export type SubstitutedOrderItem = Pick<
  schema.OrderItem,
  | 'productId'
  | 'sku'
  | 'name'
  | 'originalSku'
  | 'originalName'
  | 'originalProductId'
  | 'substitutedAt'
  | 'quantity'
>;

/**
 * Re-aplică o substituție manuală de articol (sku/name/productId + audit) pe
 * itemele proaspăt mapate din eMAG, înainte de delete+insert la re-sync —
 * altfel următorul update de comandă (schimbare status, AWB etc.) suprascrie
 * silențios substituirea făcută în UI.
 *
 * Potrivire după sku-ul dinaintea substituirii (`originalSku`, care e chiar
 * sku-ul pe care mapper-ul l-ar recalcula din payload-ul eMAG neschimbat) și
 * semnul cantității, ca liniile de storno/retur să nu fie confundate cu
 * linia normală atunci când au același sku.
 */
export function preserveSubstitutions(
  existingSubstituted: SubstitutedOrderItem[],
  items: NewOrderItem[],
): NewOrderItem[] {
  if (existingSubstituted.length === 0) return items;

  const bySkuAndSign = new Map<string, SubstitutedOrderItem[]>();
  for (const ex of existingSubstituted) {
    const key = `${ex.originalSku ?? ex.sku}:${ex.quantity < 0 ? '-' : '+'}`;
    const bucket = bySkuAndSign.get(key);
    if (bucket) bucket.push(ex);
    else bySkuAndSign.set(key, [ex]);
  }

  return items.map((item) => {
    const key = `${item.sku}:${item.quantity < 0 ? '-' : '+'}`;
    const preserved = bySkuAndSign.get(key)?.shift();
    if (!preserved) return item;
    return {
      ...item,
      productId: preserved.productId,
      sku: preserved.sku,
      name: preserved.name,
      originalSku: preserved.originalSku,
      originalName: preserved.originalName,
      originalProductId: preserved.originalProductId,
      substitutedAt: preserved.substitutedAt,
    };
  });
}
