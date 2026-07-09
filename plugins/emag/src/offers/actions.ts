import { type ActionHandler, type ActionHandlerMap } from '@opensales/plugin-sdk';
import { z } from 'zod';

import { EMAG_PLATFORMS, type EmagPlatformKey } from '../config.js';
import { readVat } from '../lookups/vat.js';

import { readCommission } from './commission.js';
import { findByEans } from './ean-search.js';
import { saveLightOffer, saveLightOffers } from './light.js';
import { saveMeasurementsBulk } from './measurements.js';
import { countOffers, readOffers } from './read.js';
import { saveProductOffer, saveProductOffers } from './save.js';
import { checkSmartDealsPrice } from './smart-deals.js';
import { updateStock } from './stock.js';

import type { EmagClient } from '../client.js';
import type { EmagLightOfferPayload } from './types.js';

/**
 * Provider de client — injectat de plugin entry. Primește opțional platforma
 * țintă; fără ea folosește platforma implicită din secrets.
 */
export type EmagClientProvider = (platform?: EmagPlatformKey) => Promise<EmagClient>;

const platformSchema = z.enum(
  Object.keys(EMAG_PLATFORMS) as [EmagPlatformKey, ...EmagPlatformKey[]],
);

// ---------- Zod schemas ----------

const stockItemSchema = z.object({
  warehouse_id: z.number().int(),
  value: z.number().int().min(0),
});

const handlingTimeItemSchema = z.object({
  warehouse_id: z.number().int(),
  value: z.number().int().min(0),
});

// syncOffers — citește pagini de oferte cu filtre.
const syncOffersInput = z.object({
  status: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  validation_status: z.number().int().optional(),
  category_id: z.number().int().optional(),
  brand: z.string().optional(),
  part_number: z.string().optional(),
  part_number_key: z.string().optional(),
  ean: z.string().optional(),
  modifiedAfter: z.string().optional(),
  modifiedBefore: z.string().optional(),
  currentPage: z.number().int().min(1).optional(),
  itemsPerPage: z.number().int().min(1).max(100).optional(),
  /** Dacă true, întoarce și totalul prin product_offer/count. */
  includeCount: z.boolean().optional(),
  /** Țara/contul eMAG din care se citesc ofertele (emag-ro/hu/bg...). Fără ea → DEFAULT_PLATFORM. */
  platform: platformSchema.optional(),
  /** Filter pentru o ofertă specifică după ID-ul eMAG intern (product_offer/read cu data.id). */
  data: z.object({ id: z.number().int() }).optional(),
});

const syncOffersOutput = z.object({
  items: z.array(z.record(z.unknown())),
  total: z.number().int().optional(),
  pages: z.number().int().optional(),
});

// pushOffer — full save (product_offer/save) sau light save (offer/save).
const offerPayloadSchema = z
  .object({
    id: z.number().int().min(1).max(16777215),
  })
  .passthrough();

const pushOfferInput = z.object({
  /** `light` => offer/save (nu validează documentația). `full` => product_offer/save. */
  mode: z.enum(['full', 'light']),
  payload: offerPayloadSchema,
  platform: platformSchema.optional(),
});

const pushOfferOutput = z.object({
  ok: z.boolean(),
  raw: z.unknown(),
});

// pushOffers — bulk save (eMAG acceptă array; max 50/request recomandat).
const pushOffersInput = z.object({
  mode: z.enum(['full', 'light']),
  payloads: z.array(offerPayloadSchema).min(1).max(50),
  platform: platformSchema.optional(),
});

const pushOffersOutput = z.object({
  ok: z.boolean(),
  raw: z.unknown(),
});

// saveMeasurements — bulk volumetry (measurements/save). Unități: mm + grame.
const measurementItemSchema = z.object({
  id: z.number().int().min(1),
  length: z.number(),
  width: z.number(),
  height: z.number(),
  weight: z.number(),
});

const saveMeasurementsInput = z.object({
  measurements: z.array(measurementItemSchema).min(1).max(50),
  platform: platformSchema.optional(),
});

const saveMeasurementsOutput = z.object({
  ok: z.boolean(),
  raw: z.unknown(),
});

// updateStock — stock-only via offer/save (light, bare-array body).
const updateStockInput = z.object({
  offerId: z.number().int().min(1),
  value: z.number().int().min(0),
  warehouseId: z.number().int().optional(),
  platform: platformSchema.optional(),
});

const updateStockOutput = z.object({
  ok: z.boolean(),
  raw: z.unknown(),
});

// readVatRates — vat/read (id + decimal value, e.g. 0 for non-VAT payer).
const readVatRatesInput = z.object({
  platform: platformSchema.optional(),
});

// eMAG returns entries shaped { vat_id, vat_rate, is_default }; keep them raw.
const readVatRatesOutput = z.object({
  rates: z.array(z.record(z.unknown())),
});

// findByEan
const findByEanInput = z.object({
  eans: z.array(z.string().min(1)).min(1).max(100),
  /** Țara/contul eMAG în al cărui catalog căutăm (emag-ro/bg/hu...). Fără ea → DEFAULT_PLATFORM. */
  platform: platformSchema.optional(),
});

const findByEanOutput = z.object({
  items: z.array(z.record(z.unknown())),
});

// readCommission
const readCommissionInput = z.object({
  offerId: z.number().int().min(1),
});

const readCommissionOutput = z.record(z.unknown());

// checkSmartDealsPrice
const checkSmartDealsInput = z.object({
  offerId: z.number().int().min(1),
});

const checkSmartDealsOutput = z.record(z.unknown());

// updatePrice — light offer/save cu DOAR câmpuri de preț (fără documentație).
const updatePriceInput = z.object({
  offerId: z.number().int().min(1),
  /** Preț de vânzare fără TVA, în unități majore (ex. 99.99) — ca pe product_offer/save. */
  salePrice: z.number().min(0),
  minSalePrice: z.number().min(0).optional(),
  maxSalePrice: z.number().min(0).optional(),
  vatId: z.number().int().optional(),
  platform: platformSchema.optional(),
});

const updatePriceOutput = z.object({
  ok: z.boolean(),
  raw: z.unknown(),
});

// ---------- Action descriptions (used in manifest) ----------

export const offerActionDescriptions = {
  syncOffers: 'Read paginated product offers from eMAG with filters.',
  pushOffer: 'Push a single offer to eMAG (full product_offer/save or light offer/save).',
  pushOffers: 'Push a batch of offers to eMAG in one request (max 50).',
  saveMeasurements: 'Save volumetry (length/width/height/weight) for offers (measurements/save).',
  updateStock: 'Stock-only update via offer/save (light, bare-array body).',
  readVatRates: 'Read available VAT rates (id + decimal value) for the marketplace.',
  findByEan: 'Search existing eMAG products by EAN(s) (find_by_eans).',
  readCommission: 'Read seller commission for an offer.',
  checkSmartDealsPrice: 'Check Smart Deals badge target price for an offer.',
  updatePrice:
    'Light price-only update via offer/save (no documentation re-validation). Sends id + sale_price only.',
} as const;

// ---------- Build ----------

/**
 * Construiește harta de action-handlers care trebuie pasată la `definePlugin`.
 *
 * Toate handler-ele primesc clientul lazy via `provider`. La invocare, parsam
 * inputul (Zod), apelăm endpoint-ul și returnăm output-ul deja unwrapped din
 * `EmagResponse.results`. Erorile bubble-up ca `EmagApiError`.
 *
 * Stockul e tipăt ca `unknown` la output pentru a păstra payload-ul brut eMAG —
 * platforma poate trata `messages` la nivel superior.
 */
export const buildOfferActions = (provider: EmagClientProvider): ActionHandlerMap => {
  // Folosim `unknown` la nivel de map pentru a respecta `ActionHandlerMap`
  // (Record<string, ActionHandler<unknown, unknown>>). Schemele Zod individuale
  // sunt totuși tipate pentru fiecare handler.

  const syncOffersHandler: ActionHandler<
    z.infer<typeof syncOffersInput>,
    z.infer<typeof syncOffersOutput>
  > = {
    input: syncOffersInput,
    output: syncOffersOutput,
    handle: async (input) => {
      const client = await provider(input.platform);
      // `platform` is routing-only — strip it from the eMAG query filters.
      const { platform: _platform, ...rest } = input;
      const filters = stripUndefined(rest);
      const items = await readOffers(client, filters);
      if (input.includeCount === true) {
        const counts = await countOffers(client, filters);
        const out: { items: Record<string, unknown>[]; total?: number; pages?: number } = {
          items,
          total: counts.noOfItems,
        };
        if (counts.noOfPages !== undefined) out.pages = counts.noOfPages;
        return out;
      }
      return { items };
    },
  };

  const pushOfferHandler: ActionHandler<
    z.infer<typeof pushOfferInput>,
    z.infer<typeof pushOfferOutput>
  > = {
    input: pushOfferInput,
    output: pushOfferOutput,
    handle: async (input) => {
      const client = await provider(input.platform);
      const payload = normalizePayload(input.payload);
      const raw =
        input.mode === 'light'
          ? await saveLightOffer(client, payload as unknown as Parameters<typeof saveLightOffer>[1])
          : await saveProductOffer(
              client,
              payload as unknown as Parameters<typeof saveProductOffer>[1],
            );
      return { ok: true, raw };
    },
  };

  const pushOffersHandler: ActionHandler<
    z.infer<typeof pushOffersInput>,
    z.infer<typeof pushOffersOutput>
  > = {
    input: pushOffersInput,
    output: pushOffersOutput,
    handle: async (input) => {
      const client = await provider(input.platform);
      const payloads = input.payloads.map((p) => normalizePayload(p));
      const raw =
        input.mode === 'light'
          ? await saveLightOffers(
              client,
              payloads as unknown as Parameters<typeof saveLightOffers>[1],
            )
          : await saveProductOffers(
              client,
              payloads as unknown as Parameters<typeof saveProductOffers>[1],
            );
      return { ok: true, raw };
    },
  };

  const saveMeasurementsHandler: ActionHandler<
    z.infer<typeof saveMeasurementsInput>,
    z.infer<typeof saveMeasurementsOutput>
  > = {
    input: saveMeasurementsInput,
    output: saveMeasurementsOutput,
    handle: async (input) => {
      const client = await provider(input.platform);
      const raw = await saveMeasurementsBulk(client, input.measurements);
      return { ok: true, raw };
    },
  };

  const updateStockHandler: ActionHandler<
    z.infer<typeof updateStockInput>,
    z.infer<typeof updateStockOutput>
  > = {
    input: updateStockInput,
    output: updateStockOutput,
    handle: async (input) => {
      const client = await provider(input.platform);
      const raw = await updateStock(client, input.offerId, input.value, input.warehouseId ?? 1);
      return { ok: true, raw };
    },
  };

  const readVatRatesHandler: ActionHandler<
    z.infer<typeof readVatRatesInput>,
    z.infer<typeof readVatRatesOutput>
  > = {
    input: readVatRatesInput,
    output: readVatRatesOutput,
    handle: async (input) => {
      const client = await provider(input.platform);
      return { rates: (await readVat(client)) as unknown as Record<string, unknown>[] };
    },
  };

  const findByEanHandler: ActionHandler<
    z.infer<typeof findByEanInput>,
    z.infer<typeof findByEanOutput>
  > = {
    input: findByEanInput,
    output: findByEanOutput,
    handle: async (input) => {
      const client = await provider(input.platform);
      const items = await findByEans(client, input.eans);
      return { items: items as unknown as Record<string, unknown>[] };
    },
  };

  const readCommissionHandler: ActionHandler<
    z.infer<typeof readCommissionInput>,
    z.infer<typeof readCommissionOutput>
  > = {
    input: readCommissionInput,
    output: readCommissionOutput,
    handle: async (input) => {
      const client = await provider();
      const result = await readCommission(client, input.offerId);
      return result;
    },
  };

  const checkSmartDealsHandler: ActionHandler<
    z.infer<typeof checkSmartDealsInput>,
    z.infer<typeof checkSmartDealsOutput>
  > = {
    input: checkSmartDealsInput,
    output: checkSmartDealsOutput,
    handle: async (input) => {
      const client = await provider();
      const result = await checkSmartDealsPrice(client, input.offerId);
      return result;
    },
  };

  const updatePriceHandler: ActionHandler<
    z.infer<typeof updatePriceInput>,
    z.infer<typeof updatePriceOutput>
  > = {
    input: updatePriceInput,
    output: updatePriceOutput,
    handle: async (input) => {
      const client = await provider(input.platform);
      // Light `offer/save` cu DOAR câmpuri de preț. Format eMAG confirmat: array
      // „gol" `[{ ... }]` (NU `{ data: [...] }`). `id` = id-ul intern de seller
      // (emag_offer_id). Fără câmpuri de documentație → nu re-declanșează validarea.
      // Trimitem doar ce modificăm (preț), fără `status`, ca să nu schimbăm starea ofertei.
      const payload: EmagLightOfferPayload = {
        id: input.offerId,
        sale_price: input.salePrice,
        ...(input.minSalePrice !== undefined ? { min_sale_price: input.minSalePrice } : {}),
        ...(input.maxSalePrice !== undefined ? { max_sale_price: input.maxSalePrice } : {}),
        ...(input.vatId !== undefined ? { vat_id: input.vatId } : {}),
      };
      const raw = await saveLightOffer(client, payload);
      return { ok: true, raw };
    },
  };

  return {
    syncOffers: syncOffersHandler as unknown as ActionHandler<unknown, unknown>,
    pushOffer: pushOfferHandler as unknown as ActionHandler<unknown, unknown>,
    pushOffers: pushOffersHandler as unknown as ActionHandler<unknown, unknown>,
    saveMeasurements: saveMeasurementsHandler as unknown as ActionHandler<unknown, unknown>,
    updateStock: updateStockHandler as unknown as ActionHandler<unknown, unknown>,
    readVatRates: readVatRatesHandler as unknown as ActionHandler<unknown, unknown>,
    findByEan: findByEanHandler as unknown as ActionHandler<unknown, unknown>,
    readCommission: readCommissionHandler as unknown as ActionHandler<unknown, unknown>,
    checkSmartDealsPrice: checkSmartDealsHandler as unknown as ActionHandler<unknown, unknown>,
    updatePrice: updatePriceHandler as unknown as ActionHandler<unknown, unknown>,
  };
};

/**
 * Strip `undefined` values to satisfy `exactOptionalPropertyTypes`. Returnează
 * un nou obiect tipăt ca `T` — cheile cu `undefined` sunt complet eliminate.
 */
const stripUndefined = <T extends Record<string, unknown>>(input: T): T => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
};

/**
 * Permite stock/handling_time ca array (forma eMAG canonical) sau ca number
 * shorthand (mapăm la warehouse_id=1) — frecventă pentru integrări simple.
 */
const normalizePayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...payload };
  if (typeof out.stock === 'number') {
    out.stock = stockItemSchema.array().parse([{ warehouse_id: 1, value: out.stock }]);
  }
  if (typeof out.handling_time === 'number') {
    out.handling_time = handlingTimeItemSchema
      .array()
      .parse([{ warehouse_id: 1, value: out.handling_time }]);
  }
  return out;
};

/**
 * Re-export — obiect plat pentru introspecție (folosit la generarea manifest-ului).
 */
export const offerActions = {
  syncOffers: {
    description: offerActionDescriptions.syncOffers,
    input: syncOffersInput,
    output: syncOffersOutput,
  },
  pushOffer: {
    description: offerActionDescriptions.pushOffer,
    input: pushOfferInput,
    output: pushOfferOutput,
  },
  pushOffers: {
    description: offerActionDescriptions.pushOffers,
    input: pushOffersInput,
    output: pushOffersOutput,
  },
  updateStock: {
    description: offerActionDescriptions.updateStock,
    input: updateStockInput,
    output: updateStockOutput,
  },
  readVatRates: {
    description: offerActionDescriptions.readVatRates,
    input: readVatRatesInput,
    output: readVatRatesOutput,
  },
  findByEan: {
    description: offerActionDescriptions.findByEan,
    input: findByEanInput,
    output: findByEanOutput,
  },
  readCommission: {
    description: offerActionDescriptions.readCommission,
    input: readCommissionInput,
    output: readCommissionOutput,
  },
  checkSmartDealsPrice: {
    description: offerActionDescriptions.checkSmartDealsPrice,
    input: checkSmartDealsInput,
    output: checkSmartDealsOutput,
  },
  updatePrice: {
    description: offerActionDescriptions.updatePrice,
    input: updatePriceInput,
    output: updatePriceOutput,
  },
} as const;
