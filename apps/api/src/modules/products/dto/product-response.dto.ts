import { type schema } from '@opensales/db';

export interface ListingInfo {
  id: string;
  pluginId: string;
  pluginPackage: string;
  platform: string;
  syncState: Record<string, unknown>;
  status: string;
}

export interface ProductResponse {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: { amountMinor: string; currency: string }; // bigint -> string
  stockQuantity: number;
  images: schema.Product['images'];
  attributes: schema.Product['attributes'];
  isActive: boolean;
  brand: string | null;
  ean: string | null;
  vatRate: number | null;
  purchasePriceAmountMinor: string | null; // bigint -> string
  fullPriceAmountMinor: string | null; // bigint -> string
  weightGrams: number | null;
  heightMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  warrantyMonths: number | null;
  handlingTimeDays: number | null;
  numberOfPackages: number | null;
  listings: ListingInfo[];
  createdAt: string;
  updatedAt: string;
  /** Doar pe răspunsul de PATCH — câmpurile pe care sistemul le-a detectat ca schimbate. */
  changedFields?: string[];
}

export function toResponse(
  p: schema.Product,
  listings: ListingInfo[] = [],
  changedFields?: string[],
): ProductResponse {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    price: { amountMinor: p.priceAmountMinor.toString(), currency: p.priceCurrency },
    stockQuantity: p.stockQuantity,
    images: p.images,
    attributes: p.attributes,
    isActive: p.isActive,
    brand: p.brand ?? null,
    ean: p.ean ?? null,
    vatRate: p.vatRate ?? null,
    purchasePriceAmountMinor: p.purchasePriceAmountMinor?.toString() ?? null,
    fullPriceAmountMinor: p.fullPriceAmountMinor?.toString() ?? null,
    weightGrams: p.weightGrams ?? null,
    heightMm: p.heightMm ?? null,
    widthMm: p.widthMm ?? null,
    lengthMm: p.lengthMm ?? null,
    warrantyMonths: p.warrantyMonths ?? null,
    handlingTimeDays: p.handlingTimeDays ?? null,
    numberOfPackages: p.numberOfPackages ?? null,
    listings,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    ...(changedFields !== undefined ? { changedFields } : {}),
  };
}
