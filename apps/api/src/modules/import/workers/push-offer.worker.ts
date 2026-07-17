import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { type Plugin, invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { ListingsService } from '../../listings/listings.service.js';
import {
  EMAG_PACKAGE,
  TEMU_PACKAGE,
  TRENDYOL_PACKAGE,
  trendyolStorefrontFor,
} from '../../marketplaces/marketplace-catalog.js';
import { PluginRequestLogService } from '../../plugin-request-log/plugin-request-log.service.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../../plugins/registry/plugin-registry.service.js';
import { ProductsService } from '../../products/products.service.js';
import { StockCodeService } from '../../products/stock-code.service.js';
import { WorkspaceService } from '../../workspace/workspace.service.js';
import { temuComplianceConfigSchema, type TemuComplianceConfig } from '../dto/push-import.dto.js';
import {
  EMAG_ASSOCIATE_JOB,
  PUSH_OFFERS_JOB,
  type EmagAssociateJob,
  type PushOffersJob,
} from '../push-jobs.js';
import {
  toEmagMeasurementsPayload,
  toEmagOfferPayload,
  toTemuCompliancePayload,
  toTemuGoodsPayload,
  toTemuSubmitPayload,
  toTrendyolItem,
  toTrendyolItemWithUniversalAttrs,
  trendyolPayloadIssues,
} from '../push-offer.mapper.js';

const EMAG_BATCH = 50;
const TRENDYOL_BATCH = 1000;
/** Max simultaneous in-flight Temu requests. The 15/s in-client limiter is the real throttle. */
const TEMU_CONCURRENCY = 20;

interface OfferContext {
  listing: schema.Listing;
  product: schema.Product;
  stockCode: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

@Injectable()
export class PushOfferWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly stockCodes: StockCodeService,
    private readonly requestLog: PluginRequestLogService,
    private readonly workspace: WorkspaceService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<PushOffersJob>(PUSH_OFFERS_JOB, (data) => this.run(data));
  }

  async run(job: PushOffersJob): Promise<void> {
    await this.execute(job);
    if (job.afterComplete) {
      await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, job.afterComplete);
      this.logger.log(
        { marketplace: job.afterComplete.marketplace },
        'push-offer worker: next marketplace queued',
      );
    }
  }

  private async execute(job: PushOffersJob): Promise<void> {
    const rows = await this.listings.listByIds(job.listingIds);
    // Observabilitate completă a căii async de push: în deploy logs vedem dacă
    // job-ul a ajuns la worker, pentru ce plugin/marketplace, câte oferte, și
    // ce branch s-a ales. Esențial când un marketplace (ex. eMAG) nu primește push.
    this.logger.log(
      {
        job: PUSH_OFFERS_JOB,
        pluginId: job.pluginId,
        marketplace: job.marketplace,
        requestedListings: job.listingIds.length,
        foundListings: rows.length,
      },
      'push-offer worker: job received',
    );
    if (rows.length === 0) {
      this.logger.warn({ pluginId: job.pluginId }, 'push-offer worker: no listings found — skip');
      return;
    }

    const plugin = await this.registry.findById(job.pluginId);
    const loaded = this.loaded.getById(job.pluginId);
    if (plugin?.status !== 'active' || !loaded) {
      this.logger.warn(
        { pluginId: job.pluginId, status: plugin?.status ?? 'missing', loaded: !!loaded },
        'push-offer worker: plugin unavailable — failing all',
      );
      await this.failAll(rows, 'plugin indisponibil');
      return;
    }

    // Batch-load all products in a single query instead of N sequential calls.
    // For products that already have a stockCode, skip the advisory-lock allocation.
    // Only products without a code (uncommon after first push) call ensureForProduct.
    const uniqueProductIds = [...new Set(rows.map((l) => l.productId))];
    const productList = await this.products.getMany(uniqueProductIds);
    const productMap = new Map(productList.map((p) => [p.id, p]));

    const contexts: OfferContext[] = [];
    for (const listing of rows) {
      const product = productMap.get(listing.productId);
      if (!product) continue;
      const stockCode = product.stockCode ?? (await this.stockCodes.ensureForProduct(product.id));
      contexts.push({ listing, product, stockCode });
    }

    this.logger.log(
      { packageName: plugin.packageName, marketplace: job.marketplace, offers: contexts.length },
      'push-offer worker: dispatching to marketplace branch',
    );

    const { vatPayer } = await this.workspace.get();

    if (plugin.packageName === EMAG_PACKAGE) {
      await this.pushEmag(loaded.instance, job.pluginId, job.marketplace, contexts, vatPayer);
    } else if (plugin.packageName === TRENDYOL_PACKAGE) {
      await this.pushTrendyol(loaded.instance, job.marketplace, contexts, vatPayer);
    } else if (plugin.packageName === TEMU_PACKAGE) {
      // Default-uri compliance account-wide din config-ul plugin-ului (override-ite per produs).
      const parsedCompliance = temuComplianceConfigSchema.safeParse(plugin.config.temuCompliance);
      await this.pushTemu(
        loaded.instance,
        contexts,
        parsedCompliance.success ? parsedCompliance.data : undefined,
        vatPayer,
      );
    } else {
      this.logger.warn(
        { packageName: plugin.packageName },
        'push-offer worker: no push branch for this plugin package',
      );
      await this.failAll(rows, `push neimplementat pentru ${plugin.packageName}`);
    }
  }

  private async pushEmag(
    instance: Plugin,
    pluginId: string,
    marketplace: string,
    contexts: OfferContext[],
    vatPayer: boolean,
  ): Promise<void> {
    const groups = chunk(contexts, EMAG_BATCH);

    // Launch all chunk requests concurrently — the in-plugin rate limiter
    // (acquireSaveOfferSlot, 150/min shared) caps the actual launch rate.
    // We do NOT await each response before launching the next (requirement #3).
    const groupResults = await Promise.allSettled(
      groups.map(async (group) => {
        const payloads = group.map((c) =>
          toEmagOfferPayload({
            product: c.product,
            syncState: c.listing.syncState,
            stockCode: c.stockCode,
            // marketplace-ul job-ului e sursa sigură a platformei (= listing.platform).
            platform: marketplace,
            vatPayer,
          }),
        );
        this.logger.log(
          {
            marketplace,
            offers: payloads.length,
            offerIds: payloads.map((p) => p.id),
          },
          'eMAG pushOffers → product_offer/save',
        );
        try {
          await invokeAction(instance, 'pushOffers', {
            mode: 'full',
            payloads,
            platform: marketplace,
          });
        } catch (err) {
          // Dacă eroarea vine de la validarea Zod (înainte de orice HTTP request),
          // EmagClient nu a rulat și plugin_request_log nu are nicio înregistrare.
          // Logăm sintetic ca să fie vizibil în pagina de debug → requests viewer.
          if (isZodError(err)) {
            void this.requestLog.record({
              pluginId,
              method: 'POST',
              url: `[validation-error] ${marketplace}/product_offer/save`,
              path: 'product_offer/save',
              requestBody: { data: payloads },
              error: err.message,
            });
          }
          throw err;
        }
        this.logger.log({ marketplace, offers: payloads.length }, 'eMAG pushOffers OK');
        // Volumetria se trimite separat (measurements/save) — best-effort.
        await this.pushEmagMeasurements(instance, marketplace, group);
        return group;
      }),
    );

    // Mark each listing based on its own group's outcome.
    for (let i = 0; i < groups.length; i++) {
      const result = groupResults[i];
      const group = groups[i] ?? [];
      if (result?.status === 'fulfilled') {
        for (const c of group) await this.markPushed(c.listing, c.stockCode);
      } else {
        const err: unknown =
          result?.status === 'rejected' ? (result.reason as unknown) : new Error('unknown');
        await this.handleEmagPushError(instance, marketplace, group, err, vatPayer);
      }
    }
  }

  /**
   * Un push eMAG a aruncat (isError:true). Răspunsul e per-produs (`Product id: N`),
   * deci tratăm fiecare ofertă separat:
   *  - eroare de caracteristici incompatibile pe emag-hu/bg → retry cu datele emag-ro;
   *  - mesaj de asociere („we found the PNK … for association") → enqueue EMAG_ASSOCIATE_JOB;
   *  - alt mesaj de eroare cu acel Product id → markError;
   *  - ofertă NEmenționată în mesaje → eMAG a salvat-o (bulk parțial) → markPushed.
   * Dacă nu putem extrage mesaje (eroare non-eMAG, ex. rețea) → markError pe tot grupul.
   */
  private async handleEmagPushError(
    instance: Plugin,
    marketplace: string,
    group: OfferContext[],
    err: unknown,
    vatPayer: boolean,
    isRetry = false,
  ): Promise<void> {
    const messages = extractEmagMessages(err);

    if (
      !isRetry &&
      (marketplace === 'emag-hu' || marketplace === 'emag-bg') &&
      hasCharacteristicError(messages)
    ) {
      await this.retryWithRoContent(instance, marketplace, group, vatPayer);
      return;
    }

    const associations = parseAssociations(messages);
    const erroredIds = parseErroredIds(messages);
    // Fără mesaje per-item (`Product id: N`) nu e o eroare parțială de bulk eMAG
    // (ex. rețea, validare Zod, timeout) → eșuează tot grupul, nu marca nimic „pushed".
    if (associations.size === 0 && erroredIds.size === 0) {
      for (const c of group) await this.markError(c.listing, err);
      return;
    }
    // Mesaj de asociere FĂRĂ `Product id` parseabil → nu știm pe care ofertă o vizează,
    // deci nu putem confirma că ofertele nemapate au fost salvate. În acest caz NU le
    // marcăm „pushed" (ar fi un status fals/invizibil) — le eșuăm conservator (re-push-abile).
    const hasUnmappableAssociation = messages.some(
      (m) => /association/i.test(m) && !/Product\s*id:\s*\d+/i.test(m),
    );
    for (const c of group) {
      const hint = associations.get(c.stockCode);
      if (hint) {
        await this.markAssociationPending(c.listing);
        await this.queue.enqueue<EmagAssociateJob>(EMAG_ASSOCIATE_JOB, {
          listingId: c.listing.id,
          ...(hint.partNumberKey ? { partNumberKey: hint.partNumberKey } : {}),
          ...(hint.ean ? { ean: hint.ean } : {}),
        });
        this.logger.log(
          { listingId: c.listing.id, stockCode: c.stockCode, pnk: hint.partNumberKey },
          'eMAG association queued',
        );
      } else if (erroredIds.has(c.stockCode)) {
        await this.markError(c.listing, new Error(erroredIds.get(c.stockCode)));
      } else if (hasUnmappableAssociation) {
        await this.markError(
          c.listing,
          new Error('eMAG: asociere necesară, dar Product id neidentificat — verifică oferta'),
        );
      } else {
        // Nementionată în mesaje → eMAG a salvat-o (bulk parțial).
        await this.markPushed(c.listing, c.stockCode);
      }
    }
  }

  /** Marchează oferta ca în curs de asociere (pending), fără eroare. */
  private async markAssociationPending(listing: schema.Listing): Promise<void> {
    await this.listings.applyPushResult(listing.id, 'pending_approval', {
      ...listing.syncState,
      push_state: 'pending',
      last_error: null,
    });
  }

  /**
   * Trimite măsurătorile (measurements/save) pentru grupul de oferte deja salvate.
   * Best-effort: ofertele au fost deja împinse, deci un eșec aici doar se loghează
   * și nu marchează listing-ul ca eroare.
   */
  private async pushEmagMeasurements(
    instance: Plugin,
    marketplace: string,
    group: OfferContext[],
  ): Promise<void> {
    const measurements = group
      .map((c) =>
        toEmagMeasurementsPayload({
          product: c.product,
          syncState: c.listing.syncState,
          stockCode: c.stockCode,
        }),
      )
      .filter((m): m is Record<string, unknown> => m !== undefined);
    if (measurements.length === 0) return;
    try {
      await invokeAction(instance, 'saveMeasurements', { measurements, platform: marketplace });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn({ marketplace, err: msg }, 'eMAG measurements/save failed (offers pushed)');
    }
  }

  /**
   * Trimite produsele pe Trendyol și marchează ofertele ca `pending` cu
   * `batch_request_id` — FĂRĂ a aștepta procesarea (fire-and-forget). Rezultatul
   * per-item (SUCCESS/FAILED), retry-urile „Universal” și aprobarea sunt tratate
   * de `TrendyolReconcileWorker` (cron). Astfel launch-rate-ul nu e gâtuit de
   * timpul de răspuns, iar aprobarea de ore/zile nu blochează worker-ul.
   *
   * Dacă oferta are deja `universal_attr_ids` (din retry-uri anterioare sau un
   * re-push manual), reaplicăm `customAttributeValue: "Universal"` pe acele atribute.
   */
  private async pushTrendyol(
    instance: Plugin,
    marketplace: string,
    contexts: OfferContext[],
    vatPayer: boolean,
  ): Promise<void> {
    const storeFrontCode = trendyolStorefrontFor(marketplace);
    const groups = chunk(contexts, TRENDYOL_BATCH);

    await Promise.allSettled(
      groups.map(async (group) => {
        // Pre-validăm fiecare item — dacă brandId/categoryId/salePrice lipsesc,
        // marcăm ca eroare imediat, fără să trimitem batch-ul cu NaN-uri care
        // ar face Zod să respingă TOATE itemele din grup.
        const valid: OfferContext[] = [];
        for (const c of group) {
          const { missingRequired } = trendyolPayloadIssues({
            product: c.product,
            syncState: c.listing.syncState,
            stockCode: c.stockCode,
          });
          if (missingRequired.length > 0) {
            await this.markError(
              c.listing,
              new Error(`Câmpuri lipsă: ${missingRequired.join(', ')}`),
            );
          } else {
            valid.push(c);
          }
        }
        if (valid.length === 0) return;

        const items = valid.map((c) => this.buildTrendyolItem(c, vatPayer));
        try {
          const res = (await invokeAction(instance, 'createProduct', {
            items,
            ...(storeFrontCode ? { storeFrontCode } : {}),
          })) as { batchRequestId?: string };
          if (!res.batchRequestId) {
            for (const c of valid)
              await this.markError(c.listing, new Error('Trendyol nu a returnat batchRequestId'));
            return;
          }
          for (const c of valid)
            await this.markTrendyolSubmitted(c.listing, res.batchRequestId, c.stockCode);
        } catch (err) {
          for (const c of valid) await this.markError(c.listing, err);
        }
      }),
    );
  }

  /** Construiește item-ul Trendyol, reaplicând override-urile „Universal” persistate. */
  private buildTrendyolItem(c: OfferContext, vatPayer: boolean): Record<string, unknown> {
    const ctx = {
      product: c.product,
      syncState: c.listing.syncState,
      stockCode: c.stockCode,
      vatPayer,
    };
    const ids = c.listing.syncState.universal_attr_ids;
    return Array.isArray(ids) && ids.length > 0
      ? toTrendyolItemWithUniversalAttrs(ctx, ids)
      : toTrendyolItem(ctx);
  }

  /** Marchează oferta ca trimisă în batch, în așteptarea reconcilierii.
   *  Persistăm `trendyol_stock_code` — id-ul folosit efectiv — ca re-push-urile
   *  ulterioare să actualizeze oferta existentă, nu să creeze un duplicat. */
  private async markTrendyolSubmitted(
    listing: schema.Listing,
    batchRequestId: string,
    stockCode: number,
  ): Promise<void> {
    await this.listings.applyPushResult(listing.id, 'draft', {
      ...listing.syncState,
      push_state: 'pending',
      batch_request_id: batchRequestId,
      trendyol_stock_code: stockCode,
      last_error: null,
    });
  }

  private async pushTemu(
    instance: Plugin,
    contexts: OfferContext[],
    temuCompliance: TemuComplianceConfig | undefined,
    vatPayer: boolean,
  ): Promise<void> {
    // Bounded concurrency: at most TEMU_CONCURRENCY requests in-flight at once.
    // The 15/s sliding-window limiter inside TemuClient.call() is the real throttle;
    // the pool cap prevents thousands of simultaneously-pending promises for large imports.
    let idx = 0;

    async function runOne(this: PushOfferWorker, ctx: OfferContext): Promise<void> {
      // Flux în 3 faze: (1) goods.v2.add creează DRAFT, (2) compliance.edit completează
      // GPSR/identificare, (3) partial.update saveMode:1 trimite la validare. Pasul 1 e
      // separat — dacă reușește avem goodsId; un eșec la 2/3 NU recreează produsul.
      const mapperCtx = {
        product: ctx.product,
        syncState: ctx.listing.syncState,
        stockCode: ctx.stockCode,
        vatPayer,
        ...(temuCompliance ? { temuCompliance } : {}),
      };
      let goodsId: number;
      let skuInfoList: { skuId?: number; outSkuSn?: string }[] | undefined;
      try {
        // Temu respinge URL-urile externe la push: încărcăm întâi fiecare imagine
        // pe CDN-ul lor și folosim URL-urile kwcdn returnate în payload.
        const uploadedImages = await this.uploadTemuImages(instance, ctx);
        const payload = toTemuGoodsPayload(mapperCtx, uploadedImages);
        const res = (await invokeAction(instance, 'pushGoods', payload)) as {
          success: boolean;
          goodsId?: number;
          skuInfoList?: { skuId?: number; outSkuSn?: string }[];
          failedList?: Record<string, unknown>[];
        };
        if (!res.success || (res.failedList?.length ?? 0) > 0) {
          const first = res.failedList?.[0];
          await this.markError(
            ctx.listing,
            new Error(first ? JSON.stringify(first) : 'Temu pushGoods eșuat'),
          );
          return;
        }
        if (res.goodsId === undefined) {
          await this.markError(ctx.listing, new Error('Temu pushGoods nu a returnat goodsId'));
          return;
        }
        goodsId = res.goodsId;
        skuInfoList = res.skuInfoList;
      } catch (err) {
        await this.markError(ctx.listing, err);
        return;
      }

      // Fazele 2+3: produsul EXISTĂ deja (goodsId). Un eșec aici păstrează goodsId
      // (markTemuStageError) ca un re-push să continue de la submit, nu să recreeze.
      try {
        const compliancePayload = toTemuCompliancePayload(mapperCtx, goodsId);
        if (compliancePayload) {
          await invokeAction(instance, 'editCompliance', compliancePayload);
        }
        await invokeAction(instance, 'submitForReview', toTemuSubmitPayload(goodsId));
      } catch (err) {
        await this.markTemuStageError(ctx.listing, goodsId, ctx.product.sku, skuInfoList, err);
        return;
      }
      await this.markTemuSubmitted(ctx.listing, ctx.product.sku, goodsId, skuInfoList);
    }

    async function worker(this: PushOfferWorker): Promise<void> {
      while (idx < contexts.length) {
        const ctx = contexts[idx++];
        if (ctx !== undefined) await runOne.call(this, ctx);
      }
    }

    const pool = Array.from({ length: Math.min(TEMU_CONCURRENCY, contexts.length) }, () =>
      worker.call(this),
    );
    await Promise.all(pool);
  }

  /**
   * Încarcă fiecare imagine a produsului pe CDN-ul Temu
   * (temu.local.goods.image.v2.upload) și întoarce URL-urile kwcdn, în ordine.
   * Pas obligatoriu înainte de temu.local.goods.v2.add — Temu respinge la push
   * imaginile externe. Limita de 15 req/s e gestionată în client.
   */
  private async uploadTemuImages(instance: Plugin, ctx: OfferContext): Promise<string[]> {
    const sourceUrls = (ctx.listing.syncState.images ?? []).map((i) => i.url);
    const catId = Number(ctx.listing.syncState.category);
    const uploaded: string[] = [];
    for (const fileUrl of sourceUrls) {
      const res = (await invokeAction(instance, 'uploadGoodsImage', {
        fileUrl,
        catId,
        usage: 3,
      })) as { url: string };
      uploaded.push(res.url);
    }
    return uploaded;
  }

  /**
   * Marchează oferta Temu ca TRIMISĂ LA VALIDARE (saveMode:1 a reușit) și PERSISTĂ
   * id-urile interne Temu: `temu_goods_id` (result.goodsId) și `temu_sku_id`
   * (result.skuInfoList[].skuId, corelat prin `outSkuSn`). Obligatorii la orice update
   * ulterior de stoc/preț (bg.local.goods.stock.edit cere goodsId + skuId).
   *
   * Status `pending_approval` (NU `active`): Temu aprobă asincron — produsul devine
   * live abia după validarea lor. Un sync ulterior îl va muta în `active`.
   */
  private async markTemuSubmitted(
    listing: schema.Listing,
    sku: string,
    goodsId: number,
    skuInfoList: { skuId?: number; outSkuSn?: string }[] | undefined,
  ): Promise<void> {
    const matched = skuInfoList?.find((s) => s.outSkuSn === sku) ?? skuInfoList?.[0];
    const skuId = matched?.skuId;
    await this.listings.applyPushResult(listing.id, 'pending_approval', {
      ...listing.syncState,
      push_state: 'submitted',
      external_offer_id: goodsId,
      temu_goods_id: goodsId,
      ...(skuId !== undefined ? { temu_sku_id: skuId } : {}),
      last_error: null,
    });
  }

  /**
   * Temu: `goods.v2.add` a reușit (avem goodsId) dar compliance/submit a eșuat.
   * Persistăm goodsId/skuId ca un re-push să continue de la submit (nu să recreeze
   * produsul) și marcăm eroare cu mesajul fazei eșuate.
   */
  private async markTemuStageError(
    listing: schema.Listing,
    goodsId: number,
    sku: string,
    skuInfoList: { skuId?: number; outSkuSn?: string }[] | undefined,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const matched = skuInfoList?.find((s) => s.outSkuSn === sku) ?? skuInfoList?.[0];
    const skuId = matched?.skuId;
    this.logger.warn(
      { listingId: listing.id, goodsId, err: message },
      'temu compliance/submit failed (goods created as draft)',
    );
    await this.listings.applyPushResult(listing.id, 'error', {
      ...listing.syncState,
      push_state: 'error',
      external_offer_id: goodsId,
      temu_goods_id: goodsId,
      ...(skuId !== undefined ? { temu_sku_id: skuId } : {}),
      last_error: { message, at: new Date().toISOString() },
    });
  }

  /**
   * Retry pentru emag-hu/bg când eMAG respinge caracteristicile ca invalide pe acea
   * piață. Preia titlul, descrierea și caracteristicile din oferta emag-ro a aceluiași
   * produs, păstrează imaginile specifice platformei (hu/bg) și adaugă
   * `source_language: 'ro_RO'` pentru ca eMAG să gestioneze traducerea automat.
   */
  private async retryWithRoContent(
    instance: Plugin,
    marketplace: string,
    group: OfferContext[],
    vatPayer: boolean,
  ): Promise<void> {
    const roListings = new Map<string, schema.Listing>();
    for (const c of group) {
      if (roListings.has(c.product.id)) continue;
      const allListings = await this.listings.listByProduct(c.product.id);
      const ro = allListings.find(
        (l) => l.platform === 'emag-ro' && l.pluginId === c.listing.pluginId,
      );
      if (ro) roListings.set(c.product.id, ro);
    }

    interface MergedEntry {
      ctx: OfferContext;
      mergedSyncState: schema.ListingSyncState;
    }
    const withRo: MergedEntry[] = [];
    const withoutRo: OfferContext[] = [];

    for (const c of group) {
      const ro = roListings.get(c.product.id);
      if (!ro) {
        withoutRo.push(c);
        continue;
      }
      withRo.push({
        ctx: c,
        mergedSyncState: {
          ...c.listing.syncState,
          title: ro.syncState.title ?? c.listing.syncState.title,
          description: ro.syncState.description ?? c.listing.syncState.description,
          characteristics: ro.syncState.characteristics ?? c.listing.syncState.characteristics,
          // images: rămân din listing-ul hu/bg (platform-specific)
        },
      });
    }

    for (const c of withoutRo) {
      await this.markError(
        c.listing,
        new Error(
          `eMAG: caracteristici incompatibile pe ${marketplace} și nu există ofertă emag-ro pentru retry automat`,
        ),
      );
    }

    if (withRo.length === 0) return;

    const retryPayloads = withRo.map(({ ctx, mergedSyncState }) =>
      toEmagOfferPayload({
        product: ctx.product,
        syncState: mergedSyncState,
        stockCode: ctx.stockCode,
        platform: marketplace,
        sourceLanguage: 'ro_RO',
        vatPayer,
      }),
    );

    this.logger.log(
      { marketplace, offers: retryPayloads.length },
      'eMAG: retry cu datele emag-ro + source_language (caracteristici incompatibile)',
    );

    try {
      await invokeAction(instance, 'pushOffers', {
        mode: 'full',
        payloads: retryPayloads,
        platform: marketplace,
      });
      this.logger.log(
        { marketplace, offers: retryPayloads.length },
        'eMAG pushOffers OK (retry RO content + source_language)',
      );
      const retryCtxs = withRo.map(({ ctx, mergedSyncState }) => ({
        ...ctx,
        listing: { ...ctx.listing, syncState: mergedSyncState },
      }));
      await this.pushEmagMeasurements(instance, marketplace, retryCtxs);
      for (const { ctx, mergedSyncState } of withRo) {
        await this.markPushed({ ...ctx.listing, syncState: mergedSyncState }, ctx.stockCode);
      }
    } catch (retryErr) {
      for (const { ctx } of withRo) await this.markError(ctx.listing, retryErr);
    }
  }

  /** eMAG: oferta a fost salvată. `externalOfferId` = stockCode = `id`-ul trimis la
   *  product_offer/save; îl persistăm și ca `emag_offer_id`, sursa canonică pentru
   *  update-urile ulterioare de stoc/preț (aceeași cheie ca la import din eMAG). */
  private async markPushed(
    listing: schema.Listing,
    externalOfferId: number,
    batchRequestId?: string,
  ): Promise<void> {
    // Dacă oferta era la status stabil (8/9), push-ul cu modificări de conținut
    // poate schimba statusul — marcăm pentru re-sincronizare de reconcile.
    const prevVsRaw = listing.syncState.validation_status;
    const prevVsObj = Array.isArray(prevVsRaw) ? (prevVsRaw as unknown[])[0] : prevVsRaw;
    const prevCode =
      prevVsObj && typeof prevVsObj === 'object'
        ? (prevVsObj as { value?: unknown }).value
        : undefined;
    const wasStable = prevCode === 8 || prevCode === 9;
    // O ofertă NOUĂ pe eMAG e abia ENQUEUE-uită la validare după product_offer/save —
    // nu e încă activă. O marcăm `pending_approval`; reconcile-ul (2h) o promovează pe
    // baza `validation_status`. O ofertă deja stabilă (8/9) care primește update de
    // conținut rămâne `active` (vandabilă în timpul re-validării).
    const pushStatus = wasStable ? 'active' : 'pending_approval';

    await this.listings.applyPushResult(listing.id, pushStatus, {
      ...listing.syncState,
      push_state: 'pushed',
      external_offer_id: externalOfferId,
      emag_offer_id: externalOfferId,
      ...(batchRequestId ? { batch_request_id: batchRequestId } : {}),
      ...(wasStable ? { needs_validation_sync: true } : {}),
      last_error: null,
    });
  }

  private async markError(listing: schema.Listing, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn({ listingId: listing.id, err: message }, 'push offer failed');
    await this.listings.applyPushResult(listing.id, 'error', {
      ...listing.syncState,
      push_state: 'error',
      last_error: { message, at: new Date().toISOString() },
    });
  }

  private async failAll(rows: schema.Listing[], reason: string): Promise<void> {
    for (const listing of rows) {
      await this.listings.applyPushResult(listing.id, 'error', {
        ...listing.syncState,
        push_state: 'error',
        last_error: { message: reason, at: new Date().toISOString() },
      });
    }
  }
}

// ZodError detectat structural (fără import din zod) — name + issues array sunt
// suficiente pentru a identifica erorile de validare pre-HTTP.
function isZodError(err: unknown): err is Error {
  return (
    err instanceof Error &&
    err.name === 'ZodError' &&
    Array.isArray((err as unknown as { issues?: unknown }).issues)
  );
}

/**
 * Detectează erorile de caracteristici incompatibile pe emag-hu/bg:
 *  - "Values are not in the restrictive list."
 *  - "Characteristic does not allow new values."
 * Mesajele pot veni în orice limbă (ro/en/hu/bg/pl) sau ca JSON stringify-at.
 */
function hasCharacteristicError(messages: string[]): boolean {
  return messages.some(
    (m) =>
      /values are not in the restrictive list/i.test(m) ||
      /valorile nu se afla in lista restrictiva/i.test(m) ||
      /characteristic does not allow new values/i.test(m) ||
      /caracteristica nu suporta valori noi/i.test(m),
  );
}

/** Mesajele eMAG dintr-un EmagApiError (`.messages` structurat sau fallback `.message`). */
function extractEmagMessages(err: unknown): string[] {
  if (err && typeof err === 'object') {
    const m = (err as { messages?: unknown }).messages;
    if (Array.isArray(m)) return m.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return [msg];
  }
  return [];
}

/**
 * Extrage din mesajele eMAG ofertele care cer ASOCIERE pe un produs existent
 * („we found the PNK … for association"), mapate după `Product id: N` (= stockCode).
 * Întoarce hint-urile PNK/EAN extrase din mesaj.
 */
function parseAssociations(
  messages: string[],
): Map<number, { partNumberKey?: string; ean?: string }> {
  const out = new Map<number, { partNumberKey?: string; ean?: string }>();
  for (const msg of messages) {
    if (!/association/i.test(msg)) continue;
    const pid = /Product\s*id:\s*(\d+)/i.exec(msg);
    if (!pid?.[1]) continue;
    const pnk = /PNK\s+([A-Za-z0-9]+)/.exec(msg);
    const ean = /EAN\s+(\d+)/.exec(msg);
    const entry: { partNumberKey?: string; ean?: string } = {};
    if (pnk?.[1]) entry.partNumberKey = pnk[1];
    if (ean?.[1]) entry.ean = ean[1];
    out.set(Number(pid[1]), entry);
  }
  return out;
}

/** Mesaje de eroare NON-asociere, mapate după `Product id: N` (= stockCode). */
function parseErroredIds(messages: string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const msg of messages) {
    if (/association/i.test(msg)) continue;
    const pid = /Product\s*id:\s*(\d+)/i.exec(msg);
    if (pid?.[1]) out.set(Number(pid[1]), msg);
  }
  return out;
}
