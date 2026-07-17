import { type schema } from '@opensales/db';
import { v7 as uuidv7 } from 'uuid';

export type TrendyolPackageRaw = Record<string, unknown>;

type OrderStatus = schema.Order['status'];

const STATUS_MAP: Record<string, OrderStatus> = {
  Awaiting: 'new',
  Created: 'new',
  Picking: 'processing',
  Invoiced: 'processing',
  Shipped: 'shipped',
  AtCollectionPoint: 'shipped',
  Delivered: 'delivered',
  UnDelivered: 'undelivered',
  Returned: 'returned',
  Cancelled: 'cancelled',
  UnPacked: 'cancelled',
};

function asString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function asNumber(v: unknown): number {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function asInt(v: unknown): number {
  if (typeof v === 'number') {
    const r = Math.round(v);
    return isNaN(r) ? 1 : r;
  }
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return isNaN(n) ? 1 : n;
  }
  return 1;
}

function toMinor(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}

/** Storefront-urile Trendyol cunoscute (vezi config.ts TRENDYOL_STOREFRONTS). */
const TRENDYOL_COUNTRY_CODES = new Set(['RO', 'GR', 'BG', 'SK', 'CZ', 'DE', 'SA', 'AE', 'KW']);

/**
 * Derivă codul marketplace ('trendyol-gr' etc.) din `countryCode`-ul adreselor
 * comenzii. API-ul Trendyol întoarce comenzi din TOATE storefront-urile indiferent
 * de header-ul storeFrontCode, deci storefront-ul cerut nu identifică sursa reală —
 * țara din adresă da. Returnează undefined dacă nicio adresă nu are un cod cunoscut.
 */
function trendyolMarketplaceFromCountry(
  ...addresses: (Record<string, unknown> | undefined)[]
): string | undefined {
  for (const addr of addresses) {
    const cc = asString(addr?.countryCode)?.toUpperCase();
    if (cc && TRENDYOL_COUNTRY_CODES.has(cc)) return `trendyol-${cc.toLowerCase()}`;
  }
  return undefined;
}

/**
 * Normalizes courier names from Trendyol to human-readable form.
 * FANEX = Fan Courier (Trendyol's internal code).
 */
function normalizeCourierName(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.toUpperCase() === 'FANEX') return 'FAN Courier';
  return raw;
}

/**
 * Result of the service's 4-step product resolution for a single order line.
 * Keyed in the map by line.merchantSku.
 */
export interface ResolvedProduct {
  productId: string | null;
  /** Our internal product SKU (used as the display SKU in order items). */
  sku: string;
  /** Our product's canonical name from the products table. */
  name?: string | undefined;
}

function mapAddress(addr: Record<string, unknown> | undefined): schema.OrderAddress {
  if (!addr) return {};
  // Prefer fullName (Trendyol invoice address field); fall back to firstName + lastName.
  const fullName = asString(addr.fullName);
  const composedName =
    [asString(addr.firstName), asString(addr.lastName)].filter(Boolean).join(' ') || undefined;
  return {
    name: fullName ?? composedName ?? undefined,
    street: asString(addr.address1) ?? undefined,
    city: asString(addr.city) ?? undefined,
    county: asString(addr.countyName) ?? asString(addr.district) ?? undefined,
    zip: asString(addr.postalCode) ?? undefined,
    country: asString(addr.countryCode) ?? undefined,
  };
}

/**
 * Extracts all identifying fields from each order line so the service can
 * perform the 4-step product resolution in a single DB pass.
 * `lineId` is the unique Trendyol line identifier (line.id / line.lineId) and
 * is used as the map key in resolveLines — this correctly handles orders where
 * multiple lines share the same `merchantSku` placeholder value.
 */
export function collectLineCandidates(pkg: TrendyolPackageRaw): {
  lineId: string;
  merchantSku: string;
  barcode: string;
  lineSku: string;
  productName: string;
}[] {
  const lines = pkg.lines as Record<string, unknown>[] | undefined;
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => ({
    lineId: asString(line.id) ?? asString(line.lineId) ?? '',
    merchantSku: asString(line.merchantSku) ?? '',
    barcode: asString(line.barcode) ?? '',
    lineSku: asString(line.sku) ?? '',
    productName: asString(line.productName) ?? '',
  }));
}

export function mapTrendyolPackageToDb(
  pkg: TrendyolPackageRaw,
  pluginId: string,
  currency: string,
  /**
   * Map keyed by line.merchantSku → resolved product info.
   * Built by the service via 4-step lookup:
   *   1. products.sku = line.merchantSku (exact)
   *   2. products.ean = line.barcode (Trendyol-listed products)
   *   3. products.ean = line.sku (Trendyol-listed products)
   *   4. line.productName contains one of our product SKUs (Trendyol-listed)
   * Fallback when nothing matches: sku = line.barcode, productId = null.
   */
  resolvedProducts: Map<string, ResolvedProduct>,
  marketplace?: string,
): { order: typeof schema.orders.$inferInsert; items: (typeof schema.orderItems.$inferInsert)[] } {
  const statusRaw = asString(pkg.status) ?? '';
  const status: OrderStatus = STATUS_MAP[statusRaw] ?? 'new';

  const grossAmount = asNumber(pkg.grossAmount);
  const totalDiscount = asNumber(pkg.packageTotalDiscount);
  // totalPrice = ce plătește efectiv clientul (grossAmount - discounturi)
  const totalPrice = asNumber(pkg.totalPrice) || grossAmount - totalDiscount;
  const totalAmountMinor = toMinor(totalPrice);
  const vouchersMinor = totalDiscount > 0 ? toMinor(totalDiscount) : null;
  // Use the currencyCode from the API response; fall back to the storefront-derived currency.
  const totalCurrency = asString(pkg.currencyCode) ?? currency;

  const firstName = asString(pkg.customerFirstName);
  const lastName = asString(pkg.customerLastName);
  const customerName = [firstName, lastName].filter(Boolean).join(' ') || null;
  const customerEmail = asString(pkg.customerEmail);

  const invoiceAddress = pkg.invoiceAddress as Record<string, unknown> | undefined;
  const shipmentAddress = pkg.shipmentAddress as Record<string, unknown> | undefined;
  const billingAddress = mapAddress(invoiceAddress);
  const shippingAddress = mapAddress(shipmentAddress);

  // AWB — cargoSenderNumber = tracking number curier propriu (Seller Pays).
  //        cargoTrackingNumber = tracking number generat de Trendyol (Trendyol Pays, necesar getCommonLabel).
  const cargoSenderNumber = asString(pkg.cargoSenderNumber);
  const cargoTrackingNumberRaw = asString(pkg.cargoTrackingNumber);
  const cargoProviderName = normalizeCourierName(asString(pkg.cargoProviderName));
  const cargoTrackingLink = asString(pkg.cargoTrackingLink);
  const now = new Date();
  const awbNumber = cargoSenderNumber ?? cargoTrackingNumberRaw;
  const awbOutgoing: schema.OrderAwb | null = awbNumber
    ? {
        number: awbNumber,
        carrier_plugin_id: pluginId,
        status: 'issued',
        issued_at: now.toISOString(),
        ...(cargoProviderName !== null ? { tracking: cargoProviderName } : {}),
        ...(cargoTrackingLink !== null ? { tracking_url: cargoTrackingLink } : {}),
        ...(cargoTrackingNumberRaw !== null
          ? { trendyol_tracking_number: cargoTrackingNumberRaw }
          : {}),
      }
    : null;

  // Invoice — Trendyol doesn't expose series/number via API; only a PDF link.
  // We store it so the platform knows a document exists and can display it.
  const invoiceLink = asString(pkg.invoiceLink);
  const invoice: schema.OrderInvoice | null = invoiceLink
    ? {
        series: '',
        number: '',
        pdf_url: invoiceLink,
        status: 'issued',
        issued_at: now.toISOString(),
      }
    : null;

  const orderDateMs = pkg.orderDate as number | undefined;
  // orderDate e timestamp epoch (ms) UTC real — verificat empiric: coincide cu
  // packageHistories.createdDate (aceeași scală, ~secunde diferență). Nota "GMT+3"
  // din documentație descrie doar cum afișează panoul Trendyol, NU un offset în
  // payload. Deci NU ajustăm cu -3h (ar muta comenzile cu 3h în trecut).
  const placedAt = orderDateMs ? new Date(orderDateMs) : now;

  // externalId = orderNumber. NOTĂ (doc Trendyol): orderNumber e comanda-PĂRINTE,
  // partajată între pachete la split/anulare parțială → coliziune teoretică pe split.
  // NU comutăm pe shipmentPackageId fără o migrare a comenzilor existente (cheiate pe
  // orderNumber) — altfel s-ar dubla la următorul sync.
  const externalId = asString(pkg.orderNumber) ?? '';

  // Marketplace-ul real derivă din țara comenzii, nu din storefront-ul cerut.
  const resolvedMarketplace =
    trendyolMarketplaceFromCountry(shipmentAddress, invoiceAddress) ?? marketplace ?? null;

  const newOrder: typeof schema.orders.$inferInsert = {
    id: uuidv7(),
    externalId,
    pluginId,
    status,
    totalAmountMinor,
    totalCurrency,
    customerName,
    customerEmail,
    billingAddress,
    shippingAddress,
    awbOutgoing,
    invoice,
    vouchersMinor,
    marketplace: resolvedMarketplace,
    placedAt,
    createdAt: now,
    updatedAt: now,
  };

  const lines = pkg.lines as Record<string, unknown>[] | undefined;
  const items: (typeof schema.orderItems.$inferInsert)[] = Array.isArray(lines)
    ? lines.map((line) => {
        const merchantSku = asString(line.merchantSku) ?? '';
        const lineId = asString(line.id) ?? asString(line.lineId) ?? '';
        const resolved = resolvedProducts.get(lineId);
        // Priority: our product SKU > barcode (fallback) > merchantSku
        const sku = resolved?.sku ?? asString(line.barcode) ?? merchantSku;
        // Priority: our product canonical name > API productName > SKU
        const name = resolved?.name ?? asString(line.productName) ?? sku;
        const quantity = asInt(line.quantity);
        // amount / lineGrossAmount = prețul brut per unitate (înainte de discount)
        const unitPriceAmountMinor = toMinor(asNumber(line.amount ?? line.lineGrossAmount));
        const productId = resolved?.productId ?? null;
        // Discount alocat direct acestei linii (seller + Trendyol) — total pentru
        // `quantity` unități, folosit la reemiterea facturii pe retur parțial.
        const lineDiscount = asNumber(line.lineSellerDiscount) + asNumber(line.lineTyDiscount);
        return {
          id: uuidv7(),
          orderId: newOrder.id,
          productId,
          sku,
          name,
          quantity,
          unitPriceAmountMinor,
          unitPriceCurrency: totalCurrency,
          voucherAmountMinor: lineDiscount > 0 ? toMinor(lineDiscount) : null,
        };
      })
    : [];

  // Discount total Trendyol (seller + campanii) — apare ca linie VOUCHER cu preț negativ.
  if (totalDiscount > 0) {
    items.push({
      id: uuidv7(),
      orderId: newOrder.id,
      productId: null,
      sku: 'VOUCHER',
      name: 'Discount Trendyol',
      quantity: 1,
      unitPriceAmountMinor: toMinor(-totalDiscount),
      unitPriceCurrency: totalCurrency,
    });
  }

  return { order: newOrder, items };
}
