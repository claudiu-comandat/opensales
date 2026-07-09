import type {
  TrendyolProduct,
  UpsertListingInput,
  UpsertProductInput,
} from './trendyol-import.types.js';

/**
 * Map a Trendyol storefront code to its ISO-4217 currency.
 *
 * Note: Bulgaria (BG) maps to EUR — Bulgaria adopted the euro and the
 * marketplace bills in EUR despite the country code suggesting BGN. The
 * other storefronts follow the documented Trendyol regional defaults.
 *
 * Falls back to EUR when the storefront is unknown.
 */
const STOREFRONT_TO_CURRENCY: Record<string, string> = {
  DE: 'EUR',
  RO: 'RON',
  BG: 'EUR',
  GR: 'EUR',
  SK: 'EUR',
  CZ: 'CZK',
  SA: 'SAR',
  AE: 'AED',
  KW: 'KWD',
};

export function mapStoreFrontToCurrency(storefront: string): string {
  return STOREFRONT_TO_CURRENCY[storefront] ?? 'EUR';
}

// ── V2 helpers ────────────────────────────────────────────────────────────────

/** Extrage numele brandului indiferent dacă e string (V1) sau obiect (V2). */
function brandName(brand: TrendyolProduct['brand']): string | null {
  if (!brand) return null;
  if (typeof brand === 'string') return brand || null;
  return brand.name || null;
}

/**
 * Returnează câmpurile de preț/stoc din primul variant V2.
 * Produce valori zero/null când produsul nu are variante.
 */
function firstVariant(p: TrendyolProduct) {
  const v = p.variants[0];
  const price = v?.price as { salePrice?: number } | undefined;
  const stock = v?.stock as { quantity?: number } | undefined;
  return {
    salePrice: price?.salePrice ?? 0,
    quantity: stock?.quantity ?? 0,
    vatRate: v?.vatRate ?? 0,
    barcode: v?.barcode ?? null,
    stockCode: v?.stockCode ?? null,
    archived: v?.archived ?? false,
    onSale: v?.onSale ?? null,
  };
}

/**
 * Normalize Trendyol rejection details into a flat list of human-readable
 * reasons. Trendyol returns these on unapproved products under various shapes
 * (array of strings, or objects with reason/name/message). We coerce to strings
 * so the UI can show "why this product is not approved" directly.
 */
export function extractRejectReasons(p: TrendyolProduct): string[] {
  const raw = p as unknown as Record<string, unknown>;
  const details = raw.rejectReasonDetails ?? raw.rejectReason ?? raw.reasons;
  if (!Array.isArray(details)) return [];
  const out: string[] = [];
  for (const d of details) {
    if (typeof d === 'string') {
      out.push(d);
    } else if (d && typeof d === 'object') {
      const o = d as Record<string, unknown>;
      const msg = o.reason ?? o.name ?? o.message ?? o.description ?? o.text;
      out.push(typeof msg === 'string' ? msg : JSON.stringify(d));
    }
  }
  return out;
}

// ── Public exports ─────────────────────────────────────────────────────────────

/**
 * Translate a Trendyol V2 product's lifecycle flags into our listing.status enum.
 *
 *  - rejected (reject reasons) → error
 *  - `archived`    → paused
 *  - `onSale`      → active  (produsele din /products/approved sunt deja aprobate)
 *  - else          → paused  (approved dar nu încă onSale / în review)
 *
 * The "not approved yet" / rejected detail is carried in `syncState.approved`
 * and `syncState.reject_reasons` so the UI can show it without a dedicated enum.
 */
export function mapStatus(p: TrendyolProduct): 'active' | 'paused' | 'error' {
  const raw = p as unknown as Record<string, unknown>;
  if (extractRejectReasons(p).length > 0) return 'error';
  const v = firstVariant(p);
  if (v.archived) return 'paused';
  if (raw.approved === false) return 'paused';
  if (v.onSale) return 'active';
  return 'paused';
}

/**
 * Build a product upsert payload from a validated Trendyol V2 product.
 *
 *  - `sku` is `productMainId` direct (per mapping spec, confirmed by user).
 *  - Price is stored in minor units (integer cents) — never float.
 *  - `ean` takes barcode from the first variant.
 */
export function toProductUpsert(p: TrendyolProduct, currency: string): UpsertProductInput {
  const raw = p as unknown as Record<string, unknown>;
  const v = firstVariant(p);
  const priceMinor = BigInt(Math.round(v.salePrice * 100));
  const categoryName = p.category?.name ?? null;
  return {
    sku: p.productMainId,
    name: p.title,
    description: p.description ?? null,
    priceAmountMinor: priceMinor,
    priceCurrency: currency,
    stockQuantity: v.quantity,
    images: p.images.map((img) => ({ url: img.url })),
    attributes: {
      productCode: p.productCode ?? null,
      stockCode: v.stockCode,
      categoryName,
      gender: raw.gender ?? null,
      attributes: p.attributes,
    },
    brand: brandName(p.brand),
    ean: v.barcode,
    vatRate: typeof v.vatRate === 'number' ? v.vatRate : null,
  };
}

/**
 * Build a listing upsert payload from a validated Trendyol V2 product.
 *
 *  - `externalListingId` folosește `contentId` (echivalentul V2 al lui `id` din V1).
 *  - `syncState` capturează câmpurile Trendyol pentru detecția drift-ului viitor.
 */
export function toListingUpsert(
  p: TrendyolProduct,
  productId: string,
  pluginId: string,
  platform: string,
  currency: string,
  /** True for non-RO storefronts when Easy Cross Country sync is enabled. */
  readOnly = false,
): UpsertListingInput {
  const raw = p as unknown as Record<string, unknown>;
  const v = firstVariant(p);
  // Namespace the listing key per storefront so the same cross-border product
  // (shared contentId across RO/BG/GR) yields one listing per country instead
  // of collapsing onto a single contentId-keyed row. Unapproved products have
  // no contentId — fall back to productMainId.
  const offerKey = typeof p.contentId === 'number' ? String(p.contentId) : p.productMainId;
  const externalListingId = `${platform}:${offerKey}`;
  const categoryName = p.category?.name ?? null;
  return {
    productId,
    pluginId,
    externalListingId,
    platform,
    status: mapStatus(p),
    syncState: {
      trendyol_id: p.contentId ?? undefined,
      productMainId: p.productMainId,
      title: p.title,
      description: p.description ?? null,
      images: p.images.map((img) => ({ url: img.url })),
      price_amount_minor: String(Math.round(v.salePrice * 100)),
      price_currency: currency,
      brand: brandName(p.brand),
      category: categoryName,
      attributes: p.attributes,
      approved: raw.approved ?? null,
      reject_reasons: extractRejectReasons(p),
      read_only: readOnly,
      archived: v.archived,
      onSale: v.onSale,
      barcode: v.barcode,
      last_sync_at: new Date().toISOString(),
      raw_marketplace: p,
      version: 1,
    },
  };
}
