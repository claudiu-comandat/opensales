import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const imageSchema = z.object({ url: z.string().url(), alt: z.string().optional() });

/** Brand Temu rezolvat (din temu.local.goods.brand.trademark.V2.get). `noTrademark:true` dacă fără brand. */
export const temuBrandSchema = z.object({
  brandId: z.number().int().optional(),
  trademarkId: z.number().int().optional(),
  noTrademark: z.boolean().optional(),
});

/** GPSR: id-urile entităților înregistrate (din compliance.info.fill.list.query). */
export const temuGpsrSchema = z.object({
  /** repId producător (complianceInfoType 3). */
  manufacturerRepId: z.number().int().optional(),
  /** repId responsabil EU (complianceInfoType 2). */
  responsiblePersonRepId: z.number().int().optional(),
});

/** Identificare produs (batch/serial) — completată prin extraTemplate la compliance.edit. */
export const temuIdentificationSchema = z.object({
  templateId: z.number().int().optional(),
  /** Cheia câmpului din șablon (refPid) — string sau number. */
  refPid: z.union([z.string(), z.number()]).optional(),
  /** Valorile (ex. numere de lot/serie) — devin multiLineInputs. */
  values: z.array(z.string()).optional(),
});

/**
 * Date specifice Temu per ofertă (schema v2 — temu.local.goods.v2.add + compliance).
 * Câmpurile de bază (shipmentLimitDay=2, fulfillmentType=1) sunt hardcodate; aici trimiți
 * doar ce e specific produsului. Câmpurile de compliance (brand/origine/gpsr/identificare)
 * sunt OPȚIONALE și suprascriu default-urile din config-ul plugin-ului (`temuCompliance`).
 */
export const temuOfferExtraSchema = z.object({
  /** Parametri pentru goodsServicePromise (ex. costTemplateId). */
  goodsServicePromise: z
    .object({
      /** Shipping template ID din bg.freight.template.list.query. */
      costTemplateId: z.string().min(1).optional(),
    })
    .optional(),
  /** Variante SKU — specId (+ parentSpecId/specName). Vezi temu.local.product.variation.get. */
  specDetails: z.array(z.record(z.unknown())).optional(),
  /** Atribute produs (refPid/vid). Cele cu required=true din temu.local.product.attributes.get. */
  goodsProperty: z.array(z.record(z.unknown())).optional(),
  /** Brand rezolvat (override peste config). */
  brand: temuBrandSchema.optional(),
  /** Țara/regiunea de origine (enum Temu) — override peste config. */
  originRegion1: z.string().optional(),
  originRegion2: z.string().optional(),
  /** GPSR repId-uri (override peste config). */
  gpsr: temuGpsrSchema.optional(),
  /** Identificare produs (batch/serial) — override peste config. */
  identification: temuIdentificationSchema.optional(),
});

/**
 * Default-uri account-wide pentru compliance Temu, stocate în `plugins.config.temuCompliance`.
 * Aceleași câmpuri ca override-urile per produs din `temuOfferExtraSchema`; per-produs câștigă.
 */
export const temuComplianceConfigSchema = z.object({
  brand: temuBrandSchema.optional(),
  originRegion1: z.string().optional(),
  originRegion2: z.string().optional(),
  gpsr: temuGpsrSchema.optional(),
  identification: temuIdentificationSchema.optional(),
});

export type TemuComplianceConfig = z.infer<typeof temuComplianceConfigSchema>;

export const pushOfferSchema = z.object({
  marketplace: z.string().min(1).max(50),
  title: z.string().max(255).optional(),
  description: z.string().max(30_000).optional().nullable(),
  images: z.array(imageSchema).optional(),
  price: z.coerce.bigint().nonnegative().optional(),
  category: z.union([z.string(), z.number()]).optional(),
  characteristics: z.unknown().optional(),
  brand: z.string().max(255).optional(),
  /** Număr de zile de procesare (handling time). Obligatoriu pentru eMAG. */
  handlingTime: z.number().int().nonnegative().optional(),
  temu: temuOfferExtraSchema.optional(),
});

export const pushProductSchema = z.object({
  sku: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  description: z.string().max(30_000).optional().nullable(),
  images: z.array(imageSchema).default([]),
  price: z.coerce.bigint().nonnegative(),
  ean: z.string().max(64).optional(),
  brand: z.string().max(255).optional(),
  stock: z.number().int().nonnegative(),
  /**
   * Identificator stabil al comenzii de aprovizionare sursă a acestui `stock` (opțional).
   * Pe calea de conflict (SKU existent), `stock` e aplicat ca DELTA aditiv — fără această
   * cheie, o retrimitere a aceleiași comenzi dublează stocul. Cu ea, retrimiterea aceleiași
   * perechi (sku, sourceOrderId) e un no-op; o comandă diferită tot se adaugă normal.
   */
  sourceOrderId: z.string().min(1).max(255).optional(),
  /** Currency of the principal price (ISO 4217). Defaults to RON. */
  currency: z.string().length(3).toUpperCase().default('RON'),
  /** Cota TVA (0 sau 21). Determină eMAG vat_id și Temu itemTaxCode. Default 0. */
  vatRate: z.number().int().min(0).max(100).default(0),
  /** Număr de zile de procesare implicit pentru toate ofertele. Poate fi suprascris per ofertă. */
  handlingTime: z.number().int().nonnegative().optional(),
  offers: z.array(pushOfferSchema).default([]),
});

export const pushImportSchema = z.object({
  products: z.array(pushProductSchema).min(1).max(5000),
  /**
   * Flux „prelistare" eMAG: stock 0, fără categorie/caracteristici — eMAG le
   * atribuie în validare. Trebuie să fie în schemă ca să supraviețuiască
   * round-trip-ului import_batches.input → re-parse în executeBatch().
   */
  prelist: z.boolean().optional(),
});

export class PushImportDto extends createZodDto(pushImportSchema) {}

/**
 * Input minimal pentru POST /import/products/prelist: doar datele pe care le
 * are userul înainte ca marfa să ajungă în depozit. Restul (stockCode,
 * fullPrice, defaults fizice, vat_id, part_number) se derivă identic cu
 * /import/products.
 */
export const prelistProductSchema = z.object({
  sku: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  brand: z.string().min(1).max(255),
  description: z.string().max(30_000).optional().nullable(),
  images: z.array(imageSchema).min(1),
  price: z.coerce.bigint().nonnegative(),
  ean: z.string().min(1).max(64),
  currency: z.string().length(3).toUpperCase().default('RON'),
  vatRate: z.number().int().min(0).max(100).default(0),
  handlingTime: z.number().int().nonnegative().optional(),
});

export const prelistImportSchema = z.object({
  products: z.array(prelistProductSchema).min(1).max(5000),
});

export class PrelistImportDto extends createZodDto(prelistImportSchema) {}

export type PrelistImportInput = z.infer<typeof prelistImportSchema>;

/** Mapează input-ul minimal de prelistare în input-ul standard de import (emag-ro, stock 0). */
export function prelistToPushImport(input: PrelistImportInput): PushImportInput {
  return {
    prelist: true,
    products: input.products.map((p) => ({
      sku: p.sku,
      title: p.title,
      description: p.description,
      images: p.images,
      price: p.price,
      ean: p.ean,
      brand: p.brand,
      stock: 0,
      currency: p.currency,
      vatRate: p.vatRate,
      handlingTime: p.handlingTime,
      offers: [{ marketplace: 'emag-ro' }],
    })),
  };
}

export type TemuOfferExtra = z.infer<typeof temuOfferExtraSchema>;
export type PushOfferInput = z.infer<typeof pushOfferSchema>;
export type PushProductInput = z.infer<typeof pushProductSchema>;
export type PushImportInput = z.infer<typeof pushImportSchema>;

export type OfferResultStatus = 'queued' | 'ignored' | 'error';
export type SkuResultStatus = 'created' | 'conflict' | 'rejected';

export interface OfferResult {
  marketplace: string;
  status: OfferResultStatus;
  reason?: string;
}

export interface SkuResult {
  sku: string;
  status: SkuResultStatus;
  reason?: string;
  offers: OfferResult[];
}

export interface PushImportResponse {
  results: SkuResult[];
}

export type ImportBatchStatus = 'processing' | 'completed' | 'failed';

/**
 * Răspunsul sincron de la POST /import/products: planul per SKU (validările
 * făcute în bloc) + identificatorul lotului care se procesează asincron.
 */
export interface ImportBatchResponse {
  batchId: string;
  status: ImportBatchStatus;
  total: number;
  processed: number;
  results: SkuResult[];
}

/** Familia de plugin pe care e mapată oferta. */
export type MarketplacePlugin = 'emag' | 'trendyol' | 'temu' | 'unknown';

/**
 * Preview dry-run al unei oferte: payload-ul COMPLET care s-ar fi trimis +
 * câmpurile obligatorii lipsă + avertismente. Nu se trimite nimic live.
 */
export interface MarketplacePayloadPreview {
  marketplace: string;
  plugin: MarketplacePlugin;
  available: boolean;
  reason?: string;
  /** Endpoint / api type țintă (informativ). */
  target: string;
  /** Moneda în care s-a calculat prețul pentru acest marketplace. */
  currency: string;
  payload: Record<string, unknown> | null;
  missingRequired: string[];
  warnings: string[];
  /** Payload-uri auxiliare (ex. eMAG measurements/save trimis separat). */
  auxPayloads?: { label: string; payload: Record<string, unknown> }[];
}

export interface ProductPayloadPreview {
  sku: string;
  marketplaces: MarketplacePayloadPreview[];
}

export interface PushPreviewResponse {
  products: ProductPayloadPreview[];
}
