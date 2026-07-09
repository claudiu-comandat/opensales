import { Injectable } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { Logger } from 'nestjs-pino';

import { DomainError } from '../../errors/domain.error.js';
import { JobQueueService } from '../../jobs/job-queue.service.js';
import { CurrencyService } from '../currency/currency.service.js';
import { ListingsService } from '../listings/listings.service.js';
import {
  EMAG_PACKAGE,
  TEMU_PACKAGE,
  TRENDYOL_PACKAGE,
  getMarketplace,
  marketplaceCurrency,
} from '../marketplaces/marketplace-catalog.js';
import {
  MarketplaceEnablementService,
  unavailableMessage,
} from '../marketplaces/marketplace-enablement.service.js';
import { createProductSchema } from '../products/dto/create-product.dto.js';
import { ProductsService } from '../products/products.service.js';
import { StockCodeService } from '../products/stock-code.service.js';

import {
  ACTIVATE_OFFERS_JOB,
  PUSH_OFFERS_JOB,
  UPDATE_STOCK_JOB,
  type ActivateOffersJob,
  type PushOffersJob,
  type UpdateStockJob,
} from './push-jobs.js';
import {
  emagPayloadIssues,
  temuPayloadIssues,
  toEmagMeasurementsPayload,
  toEmagOfferPayload,
  toTemuCompliancePayload,
  toTemuGoodsPayload,
  toTemuSubmitPayload,
  toTrendyolItem,
  trendyolPayloadIssues,
  type OfferPushContext,
} from './push-offer.mapper.js';

import type {
  MarketplacePayloadPreview,
  MarketplacePlugin,
  OfferResult,
  ProductPayloadPreview,
  PushImportInput,
  PushImportResponse,
  PushOfferInput,
  PushPreviewResponse,
  PushProductInput,
  SkuResult,
} from './dto/push-import.dto.js';

interface ImportPlan {
  pushGroups: Map<string, PushOffersJob>;
  stockProductIds: Set<string>;
  activateProductIds: Set<string>;
}

/** Câte produse pot fi procesate simultan în cadrul unui import. */
const IMPORT_CONCURRENCY = 10;

/** Placeholder pentru stock code în dry-run (alocat real abia la push live). */
const PREVIEW_STOCK_CODE = 0;

/**
 * Procesează `items` cu cel mult `limit` promisiuni în zbor simultan.
 * Ordinea rezultatelor corespunde ordinii intrărilor (results[i] → items[i]).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      // Non-null assertion is safe: items[i] always exists while i < items.length
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      results[i] = await fn(items[i]!, i);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/** Valori fizice implicite aplicate fiecărui produs (preview + create live). */
const PUSH_DEFAULTS = {
  weightGrams: 1000,
  heightMm: 100,
  widthMm: 200,
  lengthMm: 300,
  warrantyMonths: 24,
} as const;

/** Preț barat (listPrice / RRP) = preț × 1.75, în minor units. */
function fullPriceFromPrice(priceMinor: bigint): bigint {
  return (priceMinor * 175n) / 100n;
}

@Injectable()
export class PushImportService {
  constructor(
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly enablement: MarketplaceEnablementService,
    private readonly queue: JobQueueService,
    private readonly currency: CurrencyService,
    private readonly stockCodes: StockCodeService,
    private readonly logger: Logger,
  ) {}

  async import(input: PushImportInput): Promise<PushImportResponse> {
    const plan: ImportPlan = {
      pushGroups: new Map(),
      stockProductIds: new Set(),
      activateProductIds: new Set(),
    };

    // Procesează produsele cu concurență limitată (IMPORT_CONCURRENCY în zbor simultan).
    // Izolează fiecare produs: o eroare neașteptată la un SKU nu trebuie să
    // abandoneze întregul lot (esențial la importuri mari, sute de produse).
    const prelist = input.prelist === true;
    const results = await mapWithConcurrency(
      input.products,
      IMPORT_CONCURRENCY,
      async (product): Promise<SkuResult> => {
        try {
          return await this.processProduct(product, plan, prelist);
        } catch (err) {
          return {
            sku: product.sku,
            status: 'rejected',
            reason: err instanceof Error ? err.message : 'eroare necunoscută',
            offers: [],
          };
        }
      },
    );

    await this.enqueue(plan);

    // Observabilitate: în deploy logs vedem EXACT ce s-a întâmplat per ofertă —
    // ce push-uri s-au programat, pe ce marketplace, și ce oferte au fost
    // `ignored`/`error` cu motivul. Esențial când un marketplace (ex. eMAG) nu
    // primește push-ul: aici se vede dacă oferta a intrat sau nu într-un push group.
    this.logger.log(
      {
        products: results.length,
        pushGroups: [...plan.pushGroups.values()].map((g) => ({
          marketplace: g.marketplace,
          pluginId: g.pluginId,
          listings: g.listingIds.length,
        })),
        stockJobs: plan.stockProductIds.size,
        activateJobs: plan.activateProductIds.size,
        offers: results.flatMap((r) =>
          r.offers.map((o) => ({
            sku: r.sku,
            marketplace: o.marketplace,
            status: o.status,
            ...(o.reason !== undefined ? { reason: o.reason } : {}),
          })),
        ),
      },
      'push-import: plan enqueued',
    );

    return { results };
  }

  private async processProduct(
    product: PushProductInput,
    plan: ImportPlan,
    prelist = false,
  ): Promise<SkuResult> {
    const existing = await this.products.findBySku(product.sku);
    if (existing) {
      // Prelistarea e doar pentru produse noi — calea de conflict ar seta stocul
      // produsului existent la 0 (prelist trimite mereu stock 0).
      if (prelist) {
        return {
          sku: product.sku,
          status: 'rejected',
          reason: 'SKU deja existent — prelistarea e doar pentru produse noi',
          offers: [],
        };
      }
      return this.handleConflict(product, existing, plan);
    }

    if (product.ean) {
      const eanOwner = await this.products.findByEan(product.ean);
      if (eanOwner) {
        return { sku: product.sku, status: 'rejected', reason: 'EAN deja existent', offers: [] };
      }
    }
    return this.handleCreate(product, plan, prelist);
  }

  private async handleCreate(
    product: PushProductInput,
    plan: ImportPlan,
    prelist = false,
  ): Promise<SkuResult> {
    let created: schema.Product;
    try {
      created = await this.products.create(
        createProductSchema.parse({
          sku: product.sku,
          name: product.title,
          description: product.description ?? null,
          priceAmountMinor: product.price,
          priceCurrency: product.currency,
          stockQuantity: product.stock,
          images: product.images,
          attributes: {},
          isActive: true,
          brand: product.brand ?? null,
          ean: product.ean ?? null,
          fullPriceAmountMinor: fullPriceFromPrice(product.price),
          vatRate: product.vatRate,
          weightGrams: PUSH_DEFAULTS.weightGrams,
          heightMm: PUSH_DEFAULTS.heightMm,
          widthMm: PUSH_DEFAULTS.widthMm,
          lengthMm: PUSH_DEFAULTS.lengthMm,
          warrantyMonths: PUSH_DEFAULTS.warrantyMonths,
          handlingTimeDays: product.handlingTime ?? null,
        }),
      );
    } catch (err) {
      const reason =
        err instanceof DomainError && /EAN/i.test(err.message)
          ? 'EAN deja existent'
          : err instanceof Error
            ? err.message
            : 'eroare necunoscută';
      return { sku: product.sku, status: 'rejected', reason, offers: [] };
    }

    const offers = await this.planNewOffers(product, created.id, plan, prelist);
    return { sku: product.sku, status: 'created', offers };
  }

  private async handleConflict(
    product: PushProductInput,
    existing: schema.Product,
    plan: ImportPlan,
  ): Promise<SkuResult> {
    const { applied } = await this.products.applyStockContributionBySku(
      product.sku,
      product.sourceOrderId,
      product.stock,
    );
    if (applied) plan.stockProductIds.add(existing.id);
    plan.activateProductIds.add(existing.id);

    const existingListings = await this.listings.listByProduct(existing.id);
    const existingPlatforms = new Set(existingListings.map((l) => l.platform));

    const offers: OfferResult[] = [];
    for (const offer of product.offers) {
      const resolution = await this.enablement.resolve(offer.marketplace);
      if (!resolution.ok) {
        offers.push({
          marketplace: offer.marketplace,
          status: 'ignored',
          reason: unavailableMessage(offer.marketplace, resolution.reason),
        });
        continue;
      }
      // Existing offers keep their data — only stock + activation apply (product-level jobs).
      if (existingPlatforms.has(offer.marketplace)) {
        offers.push({ marketplace: offer.marketplace, status: 'queued' });
        continue;
      }
      // A marketplace the product was not on yet — add it with the sent data.
      try {
        const listing = await this.createListing(product, existing.id, resolution.plugin.id, offer);
        this.addToPushGroup(plan, resolution.plugin.id, offer.marketplace, listing.id);
        offers.push({ marketplace: offer.marketplace, status: 'queued' });
      } catch (err) {
        offers.push({
          marketplace: offer.marketplace,
          status: 'error',
          reason: err instanceof Error ? err.message : 'eroare necunoscută',
        });
      }
    }
    return { sku: product.sku, status: 'conflict', reason: 'SKU deja existent', offers };
  }

  private async planNewOffers(
    product: PushProductInput,
    productId: string,
    plan: ImportPlan,
    prelist = false,
  ): Promise<OfferResult[]> {
    const offers: OfferResult[] = [];
    for (const offer of product.offers) {
      const resolution = await this.enablement.resolve(offer.marketplace);
      if (!resolution.ok) {
        offers.push({
          marketplace: offer.marketplace,
          status: 'ignored',
          reason: unavailableMessage(offer.marketplace, resolution.reason),
        });
        continue;
      }
      try {
        const listing = await this.createListing(
          product,
          productId,
          resolution.plugin.id,
          offer,
          prelist,
        );
        this.addToPushGroup(plan, resolution.plugin.id, offer.marketplace, listing.id);
        offers.push({ marketplace: offer.marketplace, status: 'queued' });
      } catch (err) {
        offers.push({
          marketplace: offer.marketplace,
          status: 'error',
          reason: err instanceof Error ? err.message : 'eroare necunoscută',
        });
      }
    }
    return offers;
  }

  private async createListing(
    product: PushProductInput,
    productId: string,
    pluginId: string,
    offer: PushOfferInput,
    prelist = false,
  ): Promise<schema.Listing> {
    const syncState = await this.buildSyncState(product, offer);
    const rawPriceMinor = offer.price ?? product.price;
    return this.listings.upsertByExternalId({
      productId,
      pluginId,
      externalListingId: `${offer.marketplace}:${product.sku}`,
      platform: offer.marketplace,
      status: 'draft',
      syncState: {
        ...syncState,
        // Marker flux prelistare: reconcile-ul extrage categoria/caracteristicile
        // atribuite de eMAG la aprobarea documentației.
        ...(prelist ? { prelist: true } : {}),
        raw_import: {
          title: offer.title ?? product.title,
          description: offer.description ?? product.description,
          price: String(rawPriceMinor),
          currency: product.currency,
          category: offer.category,
          brand: offer.brand ?? product.brand,
          characteristics: offer.characteristics,
          images: (offer.images ?? product.images).map((i) => i.url),
          handlingTime: offer.handlingTime ?? product.handlingTime,
          temu: offer.temu,
        },
      },
    });
  }

  /** Construiește syncState-ul (cu conversie de monedă) — partajat de import și dry-run. */
  private async buildSyncState(
    product: PushProductInput,
    offer: PushOfferInput,
  ): Promise<schema.ListingSyncState> {
    const rawPriceMinor = offer.price ?? product.price;
    // Temu: prețul rămâne în RON (fără conversie FX) — decizia per-marketplace.
    const targetCurrency = offer.marketplace.startsWith('temu-')
      ? 'RON'
      : (marketplaceCurrency(offer.marketplace) ?? product.currency);
    const priceMinor =
      product.currency !== targetCurrency
        ? await this.currency.convertMinor(rawPriceMinor, product.currency, targetCurrency)
        : rawPriceMinor;
    return {
      marketplace: offer.marketplace,
      title: offer.title ?? product.title,
      description: offer.description ?? product.description ?? undefined,
      images: (offer.images ?? product.images).map((i) => ({ url: i.url })),
      price_amount_minor: String(priceMinor),
      price_currency: targetCurrency,
      brand: offer.brand ?? product.brand ?? undefined,
      category: offer.category,
      characteristics: offer.characteristics,
      push_state: 'pending',
      ...(offer.handlingTime !== undefined || product.handlingTime !== undefined
        ? { handling_time_days: offer.handlingTime ?? product.handlingTime }
        : {}),
      // Date specifice Temu — persistate ca push-ul live să producă payload identic cu preview.
      ...(offer.temu ? { temu: offer.temu } : {}),
    };
  }

  private addToPushGroup(
    plan: ImportPlan,
    pluginId: string,
    marketplace: string,
    listingId: string,
  ): void {
    const key = `${pluginId}:${marketplace}`;
    const group = plan.pushGroups.get(key);
    if (group) {
      group.listingIds.push(listingId);
    } else {
      plan.pushGroups.set(key, { pluginId, marketplace, listingIds: [listingId] });
    }
  }

  // ─────────────────────────── Dry-run preview ───────────────────────────

  /**
   * Construiește payload-urile COMPLETE care s-ar trimite către fiecare marketplace,
   * fără a scrie în DB și fără a apela API-urile. Întoarce și câmpurile obligatorii
   * lipsă + avertismente, ca să se valideze maparea înainte de push-ul live.
   */
  async previewPayloads(input: PushImportInput): Promise<PushPreviewResponse> {
    const products: ProductPayloadPreview[] = [];
    // Contor local pentru produse noi: peekNext() se apelează o singură dată (lazy),
    // apoi incrementăm per produs — simulează exact alocarea secvențială din push live.
    let nextCode: number | null = null;

    for (const product of input.products) {
      const existing = await this.products.findBySku(product.sku);
      let stockCode: number;
      if (existing?.stockCode !== null && existing?.stockCode !== undefined) {
        stockCode = existing.stockCode;
      } else {
        nextCode ??= await this.stockCodes.peekNext();
        stockCode = nextCode++;
      }

      const previewProduct = this.buildPreviewProduct(product, stockCode);
      const marketplaces: MarketplacePayloadPreview[] = [];
      for (const offer of product.offers) {
        marketplaces.push(await this.previewOffer(product, previewProduct, offer));
      }
      products.push({ sku: product.sku, marketplaces });
    }
    return { products };
  }

  private async previewOffer(
    product: PushProductInput,
    previewProduct: schema.Product,
    offer: PushOfferInput,
  ): Promise<MarketplacePayloadPreview> {
    const info = getMarketplace(offer.marketplace);
    if (!info) {
      return {
        marketplace: offer.marketplace,
        plugin: 'unknown',
        available: false,
        reason: unavailableMessage(offer.marketplace, 'unknown'),
        target: '-',
        currency: product.currency,
        payload: null,
        missingRequired: [],
        warnings: [],
      };
    }

    const family = this.pluginFamily(info.pluginPackage);
    const syncState = await this.buildSyncState(product, offer);
    const ctx: OfferPushContext = {
      product: previewProduct,
      syncState,
      stockCode: previewProduct.stockCode ?? PREVIEW_STOCK_CODE,
      platform: offer.marketplace,
    };
    const base = {
      marketplace: offer.marketplace,
      plugin: family,
      available: true,
      currency: info.currency,
    } as const;

    if (family === 'emag') {
      const measurements = toEmagMeasurementsPayload(ctx);
      return {
        ...base,
        target: 'POST /api-3/product_offer/save',
        payload: toEmagOfferPayload(ctx),
        ...emagPayloadIssues(ctx),
        ...(measurements
          ? { auxPayloads: [{ label: 'POST /api-3/measurements/save', payload: measurements }] }
          : {}),
      };
    }
    if (family === 'trendyol') {
      return {
        ...base,
        target: 'POST /integration/product/sellers/{sellerId}/v2/products',
        payload: { items: [toTrendyolItem(ctx)] },
        ...trendyolPayloadIssues(ctx),
      };
    }
    if (family === 'temu') {
      // goodsId real abia după create; în preview folosim 0 ca placeholder pentru
      // payload-urile de follow-up (compliance.edit + partial.update saveMode:1).
      const compliancePayload = toTemuCompliancePayload(ctx, 0);
      const auxPayloads: { label: string; payload: Record<string, unknown> }[] = [];
      if (compliancePayload) {
        auxPayloads.push({
          label: 'POST bg.local.goods.compliance.edit',
          payload: compliancePayload,
        });
      }
      auxPayloads.push({
        label: 'POST bg.local.goods.partial.update (saveMode:1 → review)',
        payload: toTemuSubmitPayload(0),
      });
      return {
        ...base,
        target: 'temu.local.goods.v2.add',
        payload: toTemuGoodsPayload(ctx),
        ...temuPayloadIssues(ctx),
        auxPayloads,
      };
    }
    return {
      ...base,
      available: false,
      reason: `push neimplementat pentru ${info.pluginPackage}`,
      target: '-',
      payload: null,
      missingRequired: [],
      warnings: [],
    };
  }

  private pluginFamily(pluginPackage: string): MarketplacePlugin {
    if (pluginPackage === EMAG_PACKAGE) return 'emag';
    if (pluginPackage === TRENDYOL_PACKAGE) return 'trendyol';
    if (pluginPackage === TEMU_PACKAGE) return 'temu';
    return 'unknown';
  }

  private buildPreviewProduct(product: PushProductInput, stockCode: number): schema.Product {
    const now = new Date();
    return {
      id: 'preview',
      sku: product.sku,
      name: product.title,
      description: product.description ?? null,
      priceAmountMinor: product.price,
      priceCurrency: product.currency,
      stockQuantity: product.stock,
      stockReserved: 0,
      stockZeroSince: product.stock === 0 ? now : null,
      images: product.images.map((i) => ({ url: i.url, alt: i.alt })),
      attributes: {},
      isActive: true,
      brand: product.brand ?? null,
      ean: product.ean ?? null,
      stockCode,
      vatRate: product.vatRate,
      purchasePriceAmountMinor: null,
      fullPriceAmountMinor: fullPriceFromPrice(product.price),
      weightGrams: PUSH_DEFAULTS.weightGrams,
      heightMm: PUSH_DEFAULTS.heightMm,
      widthMm: PUSH_DEFAULTS.widthMm,
      lengthMm: PUSH_DEFAULTS.lengthMm,
      warrantyMonths: PUSH_DEFAULTS.warrantyMonths,
      handlingTimeDays: null,
      numberOfPackages: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async enqueue(plan: ImportPlan): Promise<void> {
    const groups = [...plan.pushGroups.values()];

    // eMAG RO→BG→HU secvențial prin `afterComplete`: BG pornește imediat ce RO termină,
    // HU imediat ce BG termină. fd-* și orice alt marketplace rămân independente.
    const EMAG_CHAIN_ORDER = ['emag-ro', 'emag-bg', 'emag-hu'];
    const chainedEmag = EMAG_CHAIN_ORDER.map((m) => groups.find((g) => g.marketplace === m)).filter(
      (g): g is PushOffersJob => g !== undefined,
    );
    const otherGroups = groups.filter((g) => !EMAG_CHAIN_ORDER.includes(g.marketplace));

    let emagChain: PushOffersJob | undefined;
    for (const job of [...chainedEmag].reverse()) {
      emagChain = emagChain ? { ...job, afterComplete: emagChain } : job;
    }

    if (emagChain) {
      await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, emagChain);
      this.logger.log(
        {
          job: PUSH_OFFERS_JOB,
          marketplace: emagChain.marketplace,
          listingIds: emagChain.listingIds,
        },
        'enqueue push offers (eMAG chain ro→bg→hu)',
      );
    }
    for (const group of otherGroups) {
      await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, group);
      this.logger.log(
        { job: PUSH_OFFERS_JOB, marketplace: group.marketplace, listingIds: group.listingIds },
        'enqueue push offers',
      );
    }
    for (const productId of plan.stockProductIds) {
      await this.queue.enqueue<UpdateStockJob>(UPDATE_STOCK_JOB, { productId });
    }
    for (const productId of plan.activateProductIds) {
      await this.queue.enqueue<ActivateOffersJob>(ACTIVATE_OFFERS_JOB, { productId });
    }
  }
}
