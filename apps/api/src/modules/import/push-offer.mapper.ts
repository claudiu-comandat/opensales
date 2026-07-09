import { type schema } from '@opensales/db';

import type { TemuComplianceConfig, TemuOfferExtra } from './dto/push-import.dto.js';

export interface OfferPushContext {
  product: schema.Product;
  syncState: schema.ListingSyncState;
  stockCode: number;
  /** Cheia platformei eMAG (emag-ro/bg/hu, fd-ro/bg). Necesară pentru vat_id corect. */
  platform?: string;
  /** Default-uri compliance Temu din config-ul plugin-ului (override-ite de syncState.temu). */
  temuCompliance?: TemuComplianceConfig;
  /**
   * Limba conținutului sursei (ex. 'ro_RO'). Trimis la eMAG ca `source_language` — eMAG
   * gestionează traducerea automată pentru hu/bg când conținutul e preluat de la emag-ro.
   */
  sourceLanguage?: string;
}

export interface PayloadIssues {
  missingRequired: string[];
  warnings: string[];
}

/**
 * Maparea TVA → identificatorii ceruți de fiecare platformă.
 * eMAG: vat_id din vat/read — diferă per țară pentru același procent.
 *   emag-ro / fd-ro: 0% → 5
 *   emag-bg / fd-bg: 0% → 1002
 *   emag-hu:         0% → 1004  (cont fără TVA, singura rată disponibilă)
 * Temu: itemTaxCode (GEN_NOTAX la 0%, GEN_STANDARD la 21%).
 * Trendyol: trimite vatRate ca integer, deci nu are nevoie de mapare.
 */
export const EMAG_VAT_ID_BY_PLATFORM: Record<string, Record<number, number>> = {
  'emag-ro': { 0: 5 },
  'emag-bg': { 0: 1002 },
  'emag-hu': { 0: 1004 },
  'fd-ro': { 0: 5 },
  'fd-bg': { 0: 1002 },
};
export const TEMU_TAX_CODE_BY_RATE: Record<number, string> = {
  0: 'GEN_NOTAX',
  21: 'GEN_STANDARD',
};

function rateKey(vatRate: number | null | undefined): number | undefined {
  return typeof vatRate === 'number' ? vatRate : undefined;
}

export function emagVatIdForRate(
  platform: string | undefined,
  vatRate: number | null | undefined,
): number | undefined {
  const k = rateKey(vatRate);
  if (k === undefined) return undefined;
  return EMAG_VAT_ID_BY_PLATFORM[platform ?? '']?.[k];
}

export function temuTaxCodeForRate(vatRate: number | null | undefined): string | undefined {
  const k = rateKey(vatRate);
  return k === undefined ? undefined : TEMU_TAX_CODE_BY_RATE[k];
}

function majorFromMinor(minor: string | number | bigint): number {
  return Number(minor) / 100;
}

function numericOr(value: unknown, fallback = NaN): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return fallback;
}

/**
 * Imaginile ofertei: întâi cele per-ofertă din `syncState.images`, dar dacă acolo
 * e gol cădem pe `product.images`. Fără fallback, un listing creat/importat fără
 * imagini în syncState ar trimite `images: []` chiar dacă produsul ARE poze.
 */
function images(ss: schema.ListingSyncState, product: schema.Product): { url: string }[] {
  const fromState = ss.images ?? [];
  const source = fromState.length > 0 ? fromState : (product.images ?? []);
  return source.map((i) => ({ url: i.url }));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Temu `goodsBasic.goodsName` trebuie să fie ASCII (litere/cifre/punctuație
 * engleză), fără diacritice (ă â î ș ț) sau simboluri decorative (® © ™). Altfel
 * Temu respinge `goodsBasic` (ex. cod 150011003 / 150010011). Transliterăm
 * diacriticele (NFD + eliminarea semnelor combinatorii), eliminăm restul de
 * non-ASCII și limităm la 500 de caractere.
 */
function asciiGoodsName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[®©™]/g, '')
    .replace(/[^ -~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

// ───────────────────────────── eMAG ─────────────────────────────

/**
 * eMAG product_offer/save. `id` = stock code partajat; `part_number` = SKU-ul nostru.
 * `vat_id` se rezolvă din `product.vatRate` și `ctx.platform` (0% → 5/1002/1004 per țară). `min_sale_price`=1, `max`=2×sale.
 * Doc v4.5: obligatorii id, category_id, name, part_number, brand, status,
 * sale_price, min_sale_price, max_sale_price, stock, vat_id.
 */
export function toEmagOfferPayload(ctx: OfferPushContext): Record<string, unknown> {
  const { product, syncState, stockCode } = ctx;
  const sale = majorFromMinor(syncState.price_amount_minor ?? product.priceAmountMinor);
  const warranty = product.warrantyMonths ?? undefined;
  const handlingDays =
    toNumber(syncState.handling_time_days) ?? product.handlingTimeDays ?? undefined;

  return {
    id: stockCode,
    category_id: numericOr(syncState.category),
    ...(ctx.sourceLanguage ? { source_language: ctx.sourceLanguage } : {}),
    name: syncState.title ?? product.name,
    part_number: product.sku,
    brand: syncState.brand ?? product.brand ?? undefined,
    description: syncState.description ?? product.description ?? undefined,
    ...(syncState.characteristics !== undefined
      ? { characteristics: syncState.characteristics }
      : {}),
    images: images(syncState, product),
    // Forțează rescrierea integrală a galeriei (Doc 4.4.8+): fără el, eMAG face
    // merge/append peste imaginile existente, deci ștergerile/reordonările dintr-un
    // edit de produs NU s-ar reflecta. Payload-ul trimite mereu setul complet dorit.
    images_overwrite: 1,
    sale_price: sale,
    min_sale_price: 1,
    max_sale_price: Math.round(sale * 2 * 100) / 100,
    vat_id: emagVatIdForRate(ctx.platform, product.vatRate),
    status: 1,
    ...(product.ean ? { ean: [product.ean] } : {}),
    ...(warranty !== undefined ? { warranty } : {}),
    ...(handlingDays !== undefined
      ? { handling_time: [{ warehouse_id: 1, value: handlingDays }] }
      : {}),
    stock: [
      { warehouse_id: 1, value: toNumber(syncState.stock_quantity) ?? product.stockQuantity },
    ],
  };
}

/** eMAG measurements/save — trimis SEPARAT de product_offer/save. Unități: mm + grame. */
export function toEmagMeasurementsPayload(
  ctx: OfferPushContext,
): Record<string, unknown> | undefined {
  const { product, stockCode } = ctx;
  if (product.lengthMm === null || product.widthMm === null || product.heightMm === null) {
    return undefined;
  }
  return {
    id: stockCode,
    length: product.lengthMm,
    width: product.widthMm,
    height: product.heightMm,
    weight: product.weightGrams ?? 0,
  };
}

export function emagPayloadIssues(ctx: OfferPushContext): PayloadIssues {
  const { product, syncState } = ctx;
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  if (!isFiniteNumber(numericOr(syncState.category))) missingRequired.push('category_id');
  if (!(syncState.title ?? product.name)) missingRequired.push('name');
  if (!product.sku) missingRequired.push('part_number');
  if (!(syncState.brand ?? product.brand)) missingRequired.push('brand');
  if (emagVatIdForRate(ctx.platform, product.vatRate) === undefined)
    missingRequired.push(
      `vat_id (vatRate=${product.vatRate ?? 'n/a'} nemapat pe ${ctx.platform ?? 'platformă necunoscută'})`,
    );
  const sale = majorFromMinor(syncState.price_amount_minor ?? product.priceAmountMinor);
  if (!(sale > 0)) missingRequired.push('sale_price');

  const handlingDays = toNumber(syncState.handling_time_days) ?? product.handlingTimeDays;
  if (handlingDays === null || handlingDays === undefined) missingRequired.push('handling_time');

  if (!product.ean) warnings.push('ean lipsă — obligatoriu pe unele categorii eMAG');
  if (syncState.characteristics === undefined)
    warnings.push('characteristics lipsă — unele categorii cer caracteristici obligatorii');
  if ((syncState.images ?? []).length === 0) warnings.push('fără imagini');
  return { missingRequired, warnings };
}

// ─────────────────────────── Trendyol ───────────────────────────

/**
 * Construiește descrierea Trendyol.
 * Dacă descrierea e < 4000 caractere și există imagini, adaugă ultima imagine
 * ca <img src="..."> la final — Trendyol respinge descrierile prea scurte.
 */
function trendyolDescription(
  product: schema.Product,
  syncState: schema.ListingSyncState,
): string | undefined {
  const base = syncState.description ?? product.description ?? undefined;
  if (!base) return undefined;
  if (base.length >= 4000) return base;
  const imgs = syncState.images ?? [];
  const lastImg = imgs[imgs.length - 1];
  if (!lastImg) return base;
  return `${base}<img src="${lastImg.url}">`;
}

/**
 * Trendyol v2/products item. brandId/categoryId sunt id-uri Trendyol (numerice),
 * vatRate = integer trimis ca atare (0 sau 21), dimensionalWeight = 1 (fix).
 * Doc: obligatorii barcode, title, productMainId, brandId, categoryId, quantity,
 * stockCode, dimensionalWeight, description, listPrice, salePrice, vatRate, images, attributes.
 */
export function toTrendyolItem(ctx: OfferPushContext): Record<string, unknown> {
  const { product, syncState, stockCode } = ctx;
  const sale = majorFromMinor(syncState.price_amount_minor ?? product.priceAmountMinor);
  const list =
    product.fullPriceAmountMinor !== null ? majorFromMinor(product.fullPriceAmountMinor) : sale;

  // Folosim trendyol_stock_code persistent dacă există — evităm să creăm un produs
  // duplicat pe Trendyol când produsul a primit un nou stockCode (ex. după corecție).
  const trendyolId =
    typeof syncState.trendyol_stock_code === 'number' ? syncState.trendyol_stock_code : stockCode;

  return {
    barcode: product.ean,
    stockCode: String(trendyolId),
    // Trendyol respinge title > 100 caractere — trunchiem (numele produsului
    // acceptă până la 255 la create/update, dar marketplace-ul cere ≤ 100).
    title: (syncState.title ?? product.name).slice(0, 100),
    productMainId: product.sku,
    brandId: numericOr(syncState.brand),
    categoryId: numericOr(syncState.category),
    listPrice: list,
    salePrice: sale,
    vatRate: product.vatRate ?? 0,
    quantity: toNumber(syncState.stock_quantity) ?? product.stockQuantity,
    dimensionalWeight: 1,
    images: images(syncState, product),
    attributes: Array.isArray(syncState.characteristics)
      ? syncState.characteristics.map((attr) => {
          const a = attr as Record<string, unknown>;
          if ('attributeValue' in a) {
            const { attributeValue, ...rest } = a;
            return { ...rest, customAttributeValue: attributeValue };
          }
          return a;
        })
      : [],
    description: trendyolDescription(product, syncState),
  };
}

/**
 * Reconstruiește un item Trendyol în care, pentru fiecare `attributeId` dat,
 * valoarea e înlocuită cu `{ attributeId, customAttributeValue: 'Universal' }`.
 * Folosit la retry-ul după eroarea „Required category feature details not found.
 * Missing attribute Id: N”: înlocuiește un `attributeValueId` invalid sau adaugă
 * atributul dacă lipsea. `characteristics` originale rămân neatinse (override-ul
 * se memorează separat în `syncState.universal_attr_ids`).
 */
export function toTrendyolItemWithUniversalAttrs(
  ctx: OfferPushContext,
  attributeIds: number[],
): Record<string, unknown> {
  const base = toTrendyolItem(ctx);
  const attrs = [...((base.attributes as Record<string, unknown>[] | undefined) ?? [])];
  for (const id of attributeIds) {
    const override: Record<string, unknown> = {
      attributeId: id,
      customAttributeValue: 'Universal',
    };
    const i = attrs.findIndex((a) => a.attributeId === id);
    if (i >= 0) attrs[i] = override;
    else attrs.push(override);
  }
  return { ...base, attributes: attrs };
}

export function trendyolPayloadIssues(ctx: OfferPushContext): PayloadIssues {
  const { product, syncState } = ctx;
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  if (!product.ean) missingRequired.push('barcode (EAN lipsă)');
  if (!(syncState.title ?? product.name)) missingRequired.push('title');
  if (!product.sku) missingRequired.push('productMainId');
  if (!isFiniteNumber(numericOr(syncState.brand))) missingRequired.push('brandId');
  if (!isFiniteNumber(numericOr(syncState.category))) missingRequired.push('categoryId');
  const sale = majorFromMinor(syncState.price_amount_minor ?? product.priceAmountMinor);
  if (!(sale > 0)) missingRequired.push('salePrice');
  if ((syncState.images ?? []).length === 0) missingRequired.push('images');

  const baseDesc = syncState.description ?? product.description ?? '';
  const builtDesc = trendyolDescription(product, syncState) ?? '';
  if (!builtDesc) missingRequired.push('description');
  else if (baseDesc.length < 4000 && (syncState.images ?? []).length === 0)
    warnings.push('description < 4000 caractere și fără imagini — Trendyol poate respinge');
  if (!Array.isArray(syncState.characteristics) || syncState.characteristics.length === 0)
    warnings.push('attributes gol — atributele obligatorii pe categorie nu sunt validate');
  const list =
    product.fullPriceAmountMinor !== null ? majorFromMinor(product.fullPriceAmountMinor) : sale;
  if (list < sale) warnings.push('listPrice < salePrice — Trendyol cere listPrice >= salePrice');
  return { missingRequired, warnings };
}

// ───────────────────────────── Temu ─────────────────────────────

/** Extrage datele specifice Temu (costTemplateId/specDetails/goodsProperty) din syncState. */
function temuExtra(syncState: schema.ListingSyncState): TemuOfferExtra | undefined {
  return (syncState.temu as TemuOfferExtra | undefined) ?? undefined;
}

interface ResolvedTemuCompliance {
  brand?: TemuComplianceConfig['brand'];
  originRegion1?: string | undefined;
  originRegion2?: string | undefined;
  gpsr?: TemuComplianceConfig['gpsr'];
  identification?: TemuComplianceConfig['identification'];
}

/**
 * Combină datele de compliance per-produs (`syncState.temu`) peste default-urile
 * din config (`temuCompliance`). Per-produs câștigă. `gpsr` se combină pe câmp
 * (ex. responsabil EU din config + producător per-produs); restul, integral.
 */
export function resolveTemuCompliance(
  extra: TemuOfferExtra | undefined,
  config: TemuComplianceConfig | undefined,
): ResolvedTemuCompliance {
  return {
    brand: extra?.brand ?? config?.brand,
    originRegion1: extra?.originRegion1 ?? config?.originRegion1,
    originRegion2: extra?.originRegion2 ?? config?.originRegion2,
    gpsr: {
      manufacturerRepId: extra?.gpsr?.manufacturerRepId ?? config?.gpsr?.manufacturerRepId,
      responsiblePersonRepId:
        extra?.gpsr?.responsiblePersonRepId ?? config?.gpsr?.responsiblePersonRepId,
    },
    identification: extra?.identification ?? config?.identification,
  };
}

/** Construiește `gpsrInfo` (manufacturer repType 3, responsabil EU repType 2) sau undefined. */
function buildGpsrInfo(gpsr: ResolvedTemuCompliance['gpsr']): Record<string, unknown> | undefined {
  if (!gpsr) return undefined;
  const manufacturerList =
    gpsr.manufacturerRepId !== undefined
      ? [{ repType: 3, repId: gpsr.manufacturerRepId }]
      : undefined;
  const responsiblePersonList =
    gpsr.responsiblePersonRepId !== undefined
      ? [{ repType: 2, repId: gpsr.responsiblePersonRepId }]
      : undefined;
  if (!manufacturerList && !responsiblePersonList) return undefined;
  return {
    ...(manufacturerList ? { manufacturerList } : {}),
    ...(responsiblePersonList ? { responsiblePersonList } : {}),
  };
}

/** Construiește `extraTemplate` pt. identificare produs (batch/serial → multiLineInputs) sau undefined. */
function buildExtraTemplate(
  identification: ResolvedTemuCompliance['identification'],
): Record<string, unknown> | undefined {
  if (!identification) return undefined;
  const { templateId, refPid, values } = identification;
  if (templateId === undefined || refPid === undefined || !values?.length) return undefined;
  return {
    extraTemplateDetailList: [
      {
        templateId,
        inputText: {
          [String(refPid)]: { multiLineInputs: values.map((name) => ({ name })) },
        },
      },
    ],
  };
}

/** Construiește `goodsOriginInfo` din originRegion1/2 sau undefined dacă lipsește originRegion1. */
function buildGoodsOriginInfo(
  compliance: ResolvedTemuCompliance,
): Record<string, unknown> | undefined {
  if (!compliance.originRegion1) return undefined;
  return {
    originRegion1: compliance.originRegion1,
    ...(compliance.originRegion2 ? { originRegion2: compliance.originRegion2 } : {}),
    agreeDefaultOriginRegion: false,
  };
}

/**
 * Temu temu.local.goods.v2.add (schema v2). `itemTaxCode` în goodsBasic (din vatRate),
 * `externalGoodsId`/`externalSkuId` = stock code / SKU, `amount` major units (string).
 * packageInfo conform schemei v2: doar weight/length/width/height (string), fără unități.
 * Hardcodate: shipmentLimitDay=2, fulfillmentType=1.
 * `costTemplateId`, `specDetails`, `goodsProperty` se citesc din `syncState.temu`
 * (persistat la import din oferta) — aceeași sursă pentru preview și push live.
 */
export function toTemuGoodsPayload(
  ctx: OfferPushContext,
  imageUrls?: string[],
): Record<string, unknown> {
  const { product, syncState, stockCode } = ctx;
  const extra = temuExtra(syncState);
  const compliance = resolveTemuCompliance(extra, ctx.temuCompliance);
  const goodsOriginInfo = buildGoodsOriginInfo(compliance);
  // Temu: preț ÎNTOTDEAUNA în RON, dar per-ofertă — folosim prețul din syncState
  // (editabil per-ofertă) cu fallback la prețul produsului. Pentru ofertele Temu
  // `syncState.price_amount_minor` e stocat în RON (vezi buildSyncState), deci nu
  // mai facem conversie FX aici.
  const sale = majorFromMinor(syncState.price_amount_minor ?? product.priceAmountMinor);
  const currency = 'RON';
  // Imaginile se încarcă în prealabil pe CDN-ul Temu (kwcdn) și se transmit aici;
  // fallback la URL-urile din syncState pentru preview (dry-run, fără upload).
  const imgs = imageUrls ?? (syncState.images ?? []).map((i) => i.url);
  const description = syncState.description ?? product.description ?? undefined;
  const taxCode = temuTaxCodeForRate(product.vatRate);

  const packageInfo: Record<string, unknown> = {
    weight: product.weightGrams !== null ? String(product.weightGrams) : '',
    length: product.lengthMm !== null ? String(product.lengthMm) : '',
    width: product.widthMm !== null ? String(product.widthMm) : '',
    height: product.heightMm !== null ? String(product.heightMm) : '',
  };

  // catId trebuie să fie un întreg (LONG). Dacă `syncState.category` nu e
  // numeric, numericOr → NaN, care s-ar serializa ca `null` și ar declanșa
  // `Invalid Request Parameters [goodsBasic]` (150011003). Garantăm un întreg
  // finit; valoarea invalidă rămâne semnalată de temuPayloadIssues.
  const catIdRaw = numericOr(syncState.category);
  const catId = Number.isFinite(catIdRaw) ? Math.trunc(catIdRaw) : catIdRaw;

  return {
    goodsBasic: {
      goodsName: asciiGoodsName(syncState.title ?? product.name),
      catId,
      externalGoodsId: String(stockCode),
      ...(taxCode ? { itemTaxCode: taxCode } : {}),
      ...(description ? { goodsDesc: description } : {}),
      ...(compliance.brand ? { brand: compliance.brand } : {}),
    },
    goodsServicePromise: {
      shipmentLimitDay: 2,
      fulfillmentType: 1,
      costTemplateId: extra?.goodsServicePromise?.costTemplateId,
    },
    skuList: [
      {
        externalSkuId: product.sku,
        price: {
          basePrice: { amount: sale.toFixed(2), currency },
          listPrice: { amount: (sale * 2).toFixed(2), currency },
        },
        quantity: toNumber(syncState.stock_quantity) ?? product.stockQuantity,
        images: imgs,
        specDetails: extra?.specDetails ?? [],
        packageInfo,
        barCodeType: 1,
        ...(product.ean ? { barCodeId: product.ean } : {}),
      },
    ],
    ...(extra?.goodsProperty ? { goodsProperty: extra.goodsProperty } : {}),
    ...(goodsOriginInfo ? { goodsOriginInfo } : {}),
  };
}

/**
 * Payload pentru `bg.local.goods.compliance.edit` — completează GPSR + identificare
 * (extraTemplate) pe un produs deja creat. Întoarce `undefined` dacă nu sunt date de
 * trimis (caz în care workerul sare peste pasul de compliance).
 */
export function toTemuCompliancePayload(
  ctx: OfferPushContext,
  goodsId: number,
): Record<string, unknown> | undefined {
  const compliance = resolveTemuCompliance(temuExtra(ctx.syncState), ctx.temuCompliance);
  const gpsrInfo = buildGpsrInfo(compliance.gpsr);
  const extraTemplate = buildExtraTemplate(compliance.identification);
  if (!gpsrInfo && !extraTemplate) return undefined;
  return {
    goodsId,
    ...(gpsrInfo ? { gpsrInfo } : {}),
    ...(extraTemplate ? { extraTemplate } : {}),
  };
}

/** Payload pentru `bg.local.goods.partial.update` — mută draft → pending review (saveMode:1). */
export function toTemuSubmitPayload(goodsId: number): Record<string, unknown> {
  return { goodsId, saveMode: 1 };
}

export function temuPayloadIssues(ctx: OfferPushContext): PayloadIssues {
  const { product, syncState } = ctx;
  const extra = temuExtra(syncState);
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  if (!(syncState.title ?? product.name)) missingRequired.push('goodsBasic.goodsName');
  if (!isFiniteNumber(numericOr(syncState.category))) missingRequired.push('goodsBasic.catId');
  if (temuTaxCodeForRate(product.vatRate) === undefined)
    missingRequired.push(`goodsBasic.itemTaxCode (vatRate=${product.vatRate ?? 'n/a'} nemapat)`);
  if (!extra?.goodsServicePromise?.costTemplateId)
    missingRequired.push('goodsServicePromise.costTemplateId');

  const sale = majorFromMinor(syncState.price_amount_minor ?? product.priceAmountMinor);
  if (!(sale > 0)) missingRequired.push('skuList[].price.basePrice.amount');
  if (!(syncState.price_currency ?? product.priceCurrency))
    missingRequired.push('skuList[].price.basePrice.currency');
  if ((syncState.images ?? []).length === 0) missingRequired.push('skuList[].images');
  if (product.weightGrams === null) missingRequired.push('skuList[].packageInfo.weight');
  if (product.lengthMm === null || product.widthMm === null || product.heightMm === null)
    missingRequired.push('skuList[].packageInfo.length/width/height');
  if (!extra?.specDetails || extra.specDetails.length === 0)
    missingRequired.push('skuList[].specDetails');
  if (!product.ean) missingRequired.push('skuList[].barCodeId (EAN lipsă)');
  if (!extra?.goodsProperty || extra.goodsProperty.length === 0)
    missingRequired.push('goodsProperty');

  // Compliance — NU blochează submit-ul (draft→review), dar blochează vânzarea
  // după aprobare dacă lipsește. Le raportăm ca avertismente.
  const compliance = resolveTemuCompliance(extra, ctx.temuCompliance);
  if (!compliance.brand)
    warnings.push(
      'brand lipsă — setează noTrademark:true sau înregistrează brandul în Seller Center',
    );
  if (!compliance.originRegion1)
    warnings.push('goodsOriginInfo lipsă — produsul va fi restricționat la vânzare');
  if (!buildGpsrInfo(compliance.gpsr))
    warnings.push('GPSR lipsă (producător/responsabil EU) — restricționat la vânzare în UE');

  return { missingRequired, warnings };
}
