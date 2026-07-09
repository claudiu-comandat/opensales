import { z } from 'zod';

// ─── syncGoods ────────────────────────────────────────────────────────────────

export const SyncGoodsInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  /** Status: 0=off-shelf, 1=on-shelf. Omite pentru toate. */
  saleStatus: z.number().int().optional(),
  goodsName: z.string().optional(),
});

export type SyncGoodsInput = z.infer<typeof SyncGoodsInputSchema>;

export const SyncGoodsOutputSchema = z.object({
  goods: z.array(z.record(z.unknown())),
  total: z.number().optional(),
  page: z.number(),
  pageSize: z.number(),
});

export type SyncGoodsOutput = z.infer<typeof SyncGoodsOutputSchema>;

// ─── updateStock ──────────────────────────────────────────────────────────────

/**
 * bg.local.goods.stock.edit — actualizare stoc la valoare țintă (skuStockTargetList).
 * Folosește id-urile INTERNE Temu: `goodsId` (SPU) + `skuId` per variantă, obținute
 * din răspunsul `temu.local.goods.v2.add`. Stocul: întreg 0..999.999.
 */
export const UpdateStockInputSchema = z.object({
  goodsId: z.number().int(),
  /** 0 = stoc obișnuit (default), 1 = pre-sale. */
  stockType: z.number().int().default(0),
  skuStockTargetList: z
    .array(
      z.object({
        skuId: z.number().int(),
        stockTarget: z.number().int().min(0).max(999999),
      }),
    )
    .min(1),
  /** Cheie de idempotență pentru re-încercări (opțional). */
  requestUniqueKey: z.string().optional(),
});

export type UpdateStockInput = z.infer<typeof UpdateStockInputSchema>;

export const UpdateStockOutputSchema = z.object({
  success: z.boolean(),
  failedList: z.array(z.record(z.unknown())).optional(),
});

export type UpdateStockOutput = z.infer<typeof UpdateStockOutputSchema>;

// ─── setSaleStatus ────────────────────────────────────────────────────────────

export const SetSaleStatusInputSchema = z.object({
  goodsId: z.number().int(),
  /** 0=off-shelf, 1=on-shelf */
  saleStatus: z.union([z.literal(0), z.literal(1)]),
  /** 1=goods-level, 2=sku-level */
  operationType: z.union([z.literal(1), z.literal(2)]).default(1),
});

export type SetSaleStatusInput = z.infer<typeof SetSaleStatusInputSchema>;

export const SetSaleStatusOutputSchema = z.object({
  success: z.boolean(),
});

export type SetSaleStatusOutput = z.infer<typeof SetSaleStatusOutputSchema>;

// ─── pushGoods (temu.local.goods.v2.add) ────────────────────────────────────────

/** Preț SKU. `amount` în major units ca string (ex. "23.00"). Doc v2. */
export const TemuBasePriceSchema = z.object({
  basePrice: z.object({
    amount: z.string().min(1),
    currency: z.string().min(1),
  }),
});

/** Greutate/dimensiuni ca string. Schema v2: doar weight/length/width/height. */
export const TemuPackageInfoSchema = z.object({
  weight: z.string().min(1),
  length: z.string().min(1),
  width: z.string().min(1),
  height: z.string().min(1),
});

export const PushGoodsSkuSchema = z.object({
  /** Cod SKU extern unic în magazin (skuList[].externalSkuId). */
  externalSkuId: z.string().min(1),
  price: TemuBasePriceSchema,
  quantity: z.number().int().min(0),
  images: z.array(z.string().min(1)).min(1),
  /** Variante (specId/parentSpecId/Value) — depinde de variationType al categoriei. */
  specDetails: z.array(z.record(z.unknown())).default([]),
  packageInfo: TemuPackageInfoSchema,
});

export type PushGoodsSku = z.infer<typeof PushGoodsSkuSchema>;

/**
 * Brand pentru goodsBasic.brand (temu.local.goods.v2.add). brandId/trademarkId se
 * obțin din temu.local.goods.brand.trademark.V2.get; `noTrademark:true` dacă produsul
 * nu are brand înregistrat (permite trecerea la review fără brand).
 */
export const TemuBrandSchema = z.object({
  brandId: z.number().int().optional(),
  trademarkId: z.number().int().optional(),
  noTrademark: z.boolean().optional(),
});

export type TemuBrand = z.infer<typeof TemuBrandSchema>;

/**
 * Țara/regiunea de origine. `originRegion1` e un STRING dintr-un enum Temu
 * (nu există endpoint de listare — valoarea validă se confirmă la push).
 */
export const TemuGoodsOriginInfoSchema = z.object({
  originRegion1: z.string().optional(),
  originRegion2: z.string().optional(),
  agreeDefaultOriginRegion: z.boolean().optional(),
  proofImageUrls: z.array(z.string()).optional(),
  labelManufacturerProofImageUrls: z.array(z.string()).optional(),
});

export type TemuGoodsOriginInfo = z.infer<typeof TemuGoodsOriginInfoSchema>;

export const PushGoodsInputSchema = z.object({
  goodsBasic: z.object({
    goodsName: z.string().min(1),
    catId: z.number().int(),
    externalGoodsId: z.string().optional(),
    itemTaxCode: z.string().optional(),
    goodsDesc: z.string().optional(),
    brand: TemuBrandSchema.optional(),
  }),
  goodsServicePromise: z.object({
    shipmentLimitDay: z.number().int().positive(),
    /** 1 = self-fulfillment (local). */
    fulfillmentType: z.number().int().default(1),
    costTemplateId: z.string().min(1),
  }),
  skuList: z.array(PushGoodsSkuSchema).min(1),
  /** Atribute produs — obligatorii cele cu required=true din temu.local.product.attributes.get. */
  goodsProperty: z.array(z.record(z.unknown())).optional(),
  /** Țara/regiunea de origine (opțional la add; obligatoriu înainte de vânzare). */
  goodsOriginInfo: TemuGoodsOriginInfoSchema.optional(),
});

export type PushGoodsInput = z.infer<typeof PushGoodsInputSchema>;

export const PushGoodsOutputSchema = z.object({
  success: z.boolean(),
  /** ID-ul produsului returnat de Temu la creare. */
  goodsId: z.number().int().optional(),
  /** SKU-urile create cu skuId + codul extern trimis. */
  skuInfoList: z
    .array(
      z.object({
        skuId: z.number().int().optional(),
        outSkuSn: z.string().optional(),
      }),
    )
    .optional(),
  failedList: z.array(z.record(z.unknown())).optional(),
});

export type PushGoodsOutput = z.infer<typeof PushGoodsOutputSchema>;

// ─── uploadGoodsImage (temu.local.goods.image.v2.upload) ────────────────────────

export const UploadGoodsImageInputSchema = z.object({
  /** URL public al imaginii sursă (cloudinary/amazon etc.). */
  fileUrl: z.string().min(1),
  /** Categoria leaf Temu — Temu validează imaginea în contextul categoriei. */
  catId: z.number().int(),
  /** Tipul de utilizare (3 = imagine carusel/galerie produs). */
  usage: z.number().int().default(3),
});

export type UploadGoodsImageInput = z.infer<typeof UploadGoodsImageInputSchema>;

export const UploadGoodsImageOutputSchema = z.object({
  /** URL-ul găzduit pe CDN-ul Temu (kwcdn), de folosit în skuList[].images. */
  url: z.string().min(1),
});

export type UploadGoodsImageOutput = z.infer<typeof UploadGoodsImageOutputSchema>;

// ─── updatePrice (bg.local.goods.partial.update) ─────────────────────────────

/**
 * bg.local.goods.partial.update — actualizare preț SKU.
 * Folosește id-urile INTERNE Temu: `goodsId` (SPU) + `skuId` per variantă.
 * Prețul: major units ca string (ex. "357.00"), monedă ISO-4217 (ex. "RON").
 * Parametri FLAT la rădăcină (fără `data`), exact ca stock.edit.
 */
export const UpdatePriceInputSchema = z.object({
  goodsId: z.number().int(),
  skuId: z.number().int(),
  /** Preț în major units ca string (ex. "357.00"). */
  amount: z.string().min(1),
  /** Monedă ISO-4217 (ex. "RON", "EUR"). */
  currency: z.string().min(1),
});

export type UpdatePriceInput = z.infer<typeof UpdatePriceInputSchema>;

export const UpdatePriceOutputSchema = z.object({
  success: z.boolean(),
});

export type UpdatePriceOutput = z.infer<typeof UpdatePriceOutputSchema>;

// ─── readCategories ───────────────────────────────────────────────────────────

export const ReadCategoriesInputSchema = z.object({
  /** 0 = root */
  parentCatId: z.number().int().default(0),
  language: z.string().optional(),
});

export type ReadCategoriesInput = z.infer<typeof ReadCategoriesInputSchema>;

export const ReadCategoriesOutputSchema = z.array(z.record(z.unknown()));

export type ReadCategoriesOutput = z.infer<typeof ReadCategoriesOutputSchema>;
