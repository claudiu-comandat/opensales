import type { UpsertListingInput, UpsertProductInput } from './temu-import.types.js';

/**
 * Map a Temu platform code (temu-XX) to its ISO-4217 currency.
 * Falls back to 'EUR' for unknown platforms.
 */
const TEMU_PLATFORMS: Record<string, string> = {
  'temu-eu': 'EUR',
  'temu-de': 'EUR',
  'temu-fr': 'EUR',
  'temu-it': 'EUR',
  'temu-es': 'EUR',
  'temu-nl': 'EUR',
  'temu-pl': 'PLN',
  'temu-ro': 'RON',
  'temu-cz': 'CZK',
  'temu-se': 'SEK',
  'temu-dk': 'DKK',
  'temu-no': 'NOK',
  'temu-uk': 'GBP',
  'temu-us': 'USD',
  'temu-ca': 'CAD',
  'temu-au': 'AUD',
};

export function mapTemuPlatformToCurrency(platform: string): string {
  return TEMU_PLATFORMS[platform] ?? 'EUR';
}

/**
 * Translate a Temu goods item's saleStatus flag into our listing.status enum.
 *
 *  - saleStatus === 1 → active
 *  - anything else   → paused
 */
export function mapTemuStatus(item: Record<string, unknown>): 'active' | 'paused' {
  return item.saleStatus === 1 ? 'active' : 'paused';
}

/**
 * Build a product upsert payload from a raw Temu goods item.
 *
 * Mapping rules:
 *  - sku: skuList[0]?.skuExtCode if non-empty, else String(goodsId)
 *  - priceAmountMinor: BigInt(Math.round((skuList[0]?.salePrice ?? 0) * 100))
 */
export function toProductUpsert(
  item: Record<string, unknown>,
  currency: string,
): UpsertProductInput {
  const goodsId = item.goodsId as number;
  const goodsName = item.goodsName as string;
  const goodsDesc = (item.goodsDesc ?? null) as string | null;
  const skuList = (item.skuList ?? []) as Record<string, unknown>[];
  const imgList = (item.imgList ?? []) as { url: string }[];

  const firstSku = skuList[0];
  const skuExtCode = firstSku?.skuExtCode as string | undefined;
  const sku = skuExtCode && skuExtCode.length > 0 ? skuExtCode : String(goodsId);

  const salePrice = (firstSku?.salePrice ?? 0) as number;
  const priceAmountMinor = BigInt(Math.round(salePrice * 100));

  const stockQuantity = (firstSku?.stockNum ?? 0) as number;

  return {
    sku,
    name: goodsName,
    description: goodsDesc,
    priceAmountMinor,
    priceCurrency: currency,
    stockQuantity,
    images: imgList.map((img) => ({ url: img.url })),
    attributes: {
      catId: item.catId,
      skuList: item.skuList,
    },
    brand: null,
    ean: null,
    vatRate: null,
  };
}

/**
 * Build a listing upsert payload from a raw Temu goods item.
 *
 *  - externalListingId uses String(goodsId)
 *  - syncState captures Temu fields for future drift detection
 */
export function toListingUpsert(
  item: Record<string, unknown>,
  productId: string,
  pluginId: string,
  platform: string,
  currency: string,
): UpsertListingInput {
  const goodsId = item.goodsId as number;
  const externalListingId = String(goodsId);

  // currency is used in syncState for reference only
  void currency;

  return {
    productId,
    pluginId,
    externalListingId,
    platform,
    status: mapTemuStatus(item),
    syncState: {
      goodsId: item.goodsId,
      goodsName: item.goodsName,
      saleStatus: item.saleStatus,
      catId: item.catId,
      skuList: item.skuList,
      last_sync_at: new Date().toISOString(),
      raw_marketplace: item,
      version: 1,
    },
  };
}
