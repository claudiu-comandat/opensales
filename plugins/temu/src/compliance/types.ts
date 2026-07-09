import { z } from 'zod';

// ─── getBrandTrademarks (temu.local.goods.brand.trademark.V2.get) ──────────────
//
// Întoarce DOAR brandurile/trademark-urile înregistrate de vânzător în Seller
// Center (nu catalogul global Temu). Un brand trebuie aprobat în prealabil în
// Seller Center înainte de a putea fi folosit la publicare.

export const GetBrandTrademarksInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  /** Limită Temu: max 100 per pagină. */
  size: z.number().int().min(1).max(100).default(100),
});

export type GetBrandTrademarksInput = z.infer<typeof GetBrandTrademarksInputSchema>;

export const GetBrandTrademarksOutputSchema = z.object({
  trademarkList: z.array(z.record(z.unknown())),
  totalNum: z.number().optional(),
  pageNo: z.number().optional(),
});

export type GetBrandTrademarksOutput = z.infer<typeof GetBrandTrademarksOutputSchema>;

// ─── getComplianceContacts (bg.local.goods.compliance.info.fill.list.query) ────
//
// Lista entităților GPSR înregistrate de vânzător. complianceInfoType:
// 2 = responsabil EU (EU head), 3 = producător. `repStatus` 3 = aprobat.

export const GetComplianceContactsInputSchema = z.object({
  /** 2 = responsabil EU (EU head), 3 = producător. */
  complianceInfoType: z.union([z.literal(2), z.literal(3)]),
  page: z.number().int().min(1).default(1),
  /** Limită Temu: max 20 per pagină. */
  size: z.number().int().min(1).max(20).default(20),
  searchText: z.string().optional(),
  language: z.string().optional(),
});

export type GetComplianceContactsInput = z.infer<typeof GetComplianceContactsInputSchema>;

export const GetComplianceContactsOutputSchema = z.object({
  authRepInfoList: z.array(z.record(z.unknown())),
  total: z.number().optional(),
});

export type GetComplianceContactsOutput = z.infer<typeof GetComplianceContactsOutputSchema>;

// ─── getProductAttributes (temu.local.product.attributes.get) ──────────────────
//
// Atributele unei categorii leaf: `required`, valorile permise (vid) și
// unitățile (valueUnitId). Sursa pentru a construi `goodsProperty`.

export const GetProductAttributesInputSchema = z.object({
  catId: z.number().int(),
  language: z.string().optional(),
  /** Influențează câmpurile obligatorii pentru logica cross-border (opțional). */
  costTemplateId: z.string().optional(),
});

export type GetProductAttributesInput = z.infer<typeof GetProductAttributesInputSchema>;

export const GetProductAttributesOutputSchema = z.object({
  catId: z.number().optional(),
  language: z.string().optional(),
  attributeList: z.array(z.record(z.unknown())),
});

export type GetProductAttributesOutput = z.infer<typeof GetProductAttributesOutputSchema>;

// ─── getComplianceExtraTemplate (bg.local.goods.compliance.extra.template.get) ─
//
// Șabloanele de guvernanță/compliance per categorie (ex. identificare produs —
// batch/serial, date de ambalaj). Întoarce templateId + câmpuri (refPid).

export const GetComplianceExtraTemplateInputSchema = z.object({
  catId: z.number().int(),
  /** Opțional — pentru a citi regulile deja completate pe un produs. */
  goodsId: z.number().int().optional(),
});

export type GetComplianceExtraTemplateInput = z.infer<typeof GetComplianceExtraTemplateInputSchema>;

export const GetComplianceExtraTemplateOutputSchema = z.object({
  extraTemplateList: z.array(z.record(z.unknown())),
});

export type GetComplianceExtraTemplateOutput = z.infer<
  typeof GetComplianceExtraTemplateOutputSchema
>;

// ─── editCompliance (bg.local.goods.compliance.edit) ───────────────────────────
//
// Completează informațiile de compliance pe un produs deja creat (draft):
// GPSR (producător + responsabil EU) și extraTemplate (identificare/ambalaj).

/** Referință GPSR: `repType` (2=responsabil EU, 3=producător) + `repId`. */
export const GpsrRepSchema = z.object({
  repType: z.number().int(),
  repId: z.number().int(),
});

export const GpsrInfoSchema = z.object({
  manufacturerList: z.array(GpsrRepSchema).optional(),
  responsiblePersonList: z.array(GpsrRepSchema).optional(),
});

export type GpsrInfo = z.infer<typeof GpsrInfoSchema>;

export const EditComplianceInputSchema = z.object({
  goodsId: z.number().int(),
  gpsrInfo: GpsrInfoSchema.optional(),
  /** Structură de guvernanță (identificare produs / ambalaj). Vezi extra.template.get. */
  extraTemplate: z.record(z.unknown()).optional(),
  certificateInfo: z.record(z.unknown()).optional(),
  repInfo: z.record(z.unknown()).optional(),
});

export type EditComplianceInput = z.infer<typeof EditComplianceInputSchema>;

export const EditComplianceOutputSchema = z.object({
  success: z.boolean(),
});

export type EditComplianceOutput = z.infer<typeof EditComplianceOutputSchema>;

// ─── submitForReview (bg.local.goods.partial.update) ───────────────────────────
//
// Mută produsul din draft în „pending review" prin saveMode:1. Restul câmpurilor
// produsului (goodsBasic/skuList/goodsProperty) sunt păstrate — update parțial.

export const SubmitForReviewInputSchema = z.object({
  goodsId: z.number().int(),
  /** 1 = Submitted (intră în review), 2 = Saved as draft. Default 1. */
  saveMode: z.union([z.literal(1), z.literal(2)]).default(1),
  /** Brand la nivel top-level pentru partial.update (alternativ la goodsBasic.brand din add). */
  goodsTrademark: z.record(z.unknown()).optional(),
  goodsOriginInfo: z.record(z.unknown()).optional(),
  taxCodeInfo: z.record(z.unknown()).optional(),
});

export type SubmitForReviewInput = z.infer<typeof SubmitForReviewInputSchema>;

export const SubmitForReviewOutputSchema = z.object({
  success: z.boolean(),
  /** ID pentru interogarea ulterioară a rezultatului auditului acestei modificări. */
  modifyId: z.string().optional(),
});

export type SubmitForReviewOutput = z.infer<typeof SubmitForReviewOutputSchema>;
