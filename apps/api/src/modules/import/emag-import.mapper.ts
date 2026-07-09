import type {
  EmagOfferReadItem,
  UpsertListingInput,
  UpsertProductInput,
} from './emag-import.types.js';

const PLATFORM_TO_CURRENCY: Record<string, string> = {
  'emag-ro': 'RON',
  'emag-bg': 'BGN',
  'emag-hu': 'HUF',
  'fd-ro': 'RON',
  'fd-bg': 'BGN',
};

/**
 * Map an eMAG / FashionDays platform code to its ISO-4217 currency.
 * Falls back to RON when the platform is unknown (defensive default — RON
 * is the most common configuration in this codebase).
 */
export function mapPlatformToCurrency(platform: string): string {
  return PLATFORM_TO_CURRENCY[platform] ?? 'RON';
}

/**
 * Translate eMAG numeric offer.status into our listing.status enum.
 *  - 1 → active
 *  - 0 → paused (inactive in eMAG terms)
 *  - 2 → error (EOL — keep listed but flagged)
 *  - other → error (defensive)
 */
export function mapStatus(emagStatus: number): 'active' | 'paused' | 'error' {
  if (emagStatus === 1) return 'active';
  if (emagStatus === 0) return 'paused';
  return 'error';
}

/**
 * Build a product upsert payload from a validated eMAG offer.
 *
 *  - `sku` is `part_number` direct (per mapping spec).
 *  - Price is stored in minor units (integer cents) — never float.
 *  - First EAN is promoted to `product.ean`; remainder are dropped.
 */
export function toProductUpsert(
  offer: EmagOfferReadItem,
  currency: string,
  vatRate: number | null,
  /**
   * Images to use when the offer itself ships none (eMAG HU/BG offers often
   * return `images: []`). Resolved by the caller from the matching RO offer
   * (same EAN). Empty by default.
   */
  fallbackImages: { url: string }[] = [],
): UpsertProductInput {
  const firstEan = offer.ean[0] ?? null;
  const priceMinor = BigInt(Math.round(offer.sale_price * 100));
  // eMAG sometimes returns part_number as "{product_code}-{offer_id}".
  // Strip the suffix when present so the SKU reflects the actual product code.
  const offerIdSuffix = `-${offer.id}`;
  const sku = offer.part_number.endsWith(offerIdSuffix)
    ? offer.part_number.slice(0, -offerIdSuffix.length)
    : offer.part_number;
  const images =
    offer.images.length > 0 ? offer.images.map((img) => ({ url: img.url })) : fallbackImages;

  return {
    sku,
    name: offer.name,
    description: offer.description ?? null,
    priceAmountMinor: priceMinor,
    priceCurrency: currency,
    stockQuantity: offer.general_stock,
    images,
    attributes: {
      part_number_key: offer.part_number_key ?? null,
      characteristics: offer.characteristics,
    },
    brand: offer.brand ?? null,
    ean: firstEan,
    vatRate,
  };
}

/**
 * Build a listing upsert payload from a validated eMAG offer.
 *
 *  - `externalListingId` is namespaced per platform (`<platform>:<PNK>`) so the
 *    same product on emag-ro/hu/bg yields three coexisting listings instead of
 *    collapsing onto one via the `(plugin_id, external_listing_id)` conflict
 *    target. eMAG shares the PNK across country catalogs, so without the prefix
 *    the country passes overwrite each other (last platform wins).
 *  - `syncState` captures the eMAG offer id + validation flags so future
 *    push-flows can detect drift.
 */
export function toListingUpsert(
  offer: EmagOfferReadItem,
  productId: string,
  pluginId: string,
  platform: string,
  currency: string,
  /** Fallback images (from the matching RO offer) when this offer ships none. */
  fallbackImages: { url: string }[] = [],
): UpsertListingInput {
  const offerKey = offer.part_number_key ?? `emag-offer-${offer.id}`;
  const externalListingId = `${platform}:${offerKey}`;
  const images =
    offer.images.length > 0 ? offer.images.map((img) => ({ url: img.url })) : fallbackImages;
  return {
    productId,
    pluginId,
    externalListingId,
    platform,
    status: mapStatus(offer.status),
    syncState: {
      emag_offer_id: offer.id,
      title: offer.name,
      description: offer.description ?? null,
      images,
      characteristics: offer.characteristics,
      price_amount_minor: String(Math.round(offer.sale_price * 100)),
      price_currency: currency,
      validation_status: offer.validation_status ?? null,
      offer_validation_status: offer.offer_validation_status ?? null,
      last_sync_at: new Date().toISOString(),
      raw_marketplace: offer,
      version: 1,
    },
  };
}
