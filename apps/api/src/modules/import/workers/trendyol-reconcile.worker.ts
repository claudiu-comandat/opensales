import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { type Plugin, invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { ListingsService } from '../../listings/listings.service.js';
import { TRENDYOL_PACKAGE, trendyolStorefrontFor } from '../../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../../plugins/registry/plugin-registry.service.js';
import { ProductsService } from '../../products/products.service.js';
import { StockCodeService } from '../../products/stock-code.service.js';
import {
  TRENDYOL_RECONCILE_APPROVAL_JOB,
  TRENDYOL_RECONCILE_BATCHES_JOB,
  type TrendyolReconcileApprovalJob,
  type TrendyolReconcileBatchesJob,
} from '../push-jobs.js';
import { toTrendyolItemWithUniversalAttrs } from '../push-offer.mapper.js';
import { extractRejectReasons } from '../trendyol-import.mapper.js';
import { type TrendyolProduct } from '../trendyol-import.types.js';

/** Câte runde de retry „Universal” încercăm înainte de a marca oferta ca eroare. */
const RETRY_ROUND_CAP = 3;
const TRENDYOL_BATCH = 1000;
/** Cron: la fiecare 2 minute (verifică batch-urile în așteptare). */
const BATCHES_CRON = '*/2 * * * *';
/** Cron: la fiecare 2 ore (urmărește aprobarea ofertelor trimise). */
const APPROVAL_CRON = '0 */2 * * *';

const MISSING_ATTR_PREFIX = 'Required category feature details not found. Missing attribute Id:';
const MISSING_ATTR_RE = /Missing attribute Id:\s*(\d+)/;

interface OfferContext {
  listing: schema.Listing;
  product: schema.Product;
  stockCode: number;
}

// ─── Zod pentru răspunsurile (validate, fără `any`) ───────────────────────────

const batchItemSchema = z.object({
  requestItem: z
    .object({
      product: z
        .object({
          barcode: z.string().optional(),
          productMainId: z.string().optional(),
          stockCode: z.string().optional(),
        })
        .partial()
        .optional(),
    })
    .optional(),
  status: z.string().optional(),
  failureReasons: z.array(z.string()).optional(),
});
type BatchItem = z.infer<typeof batchItemSchema>;

const batchResultSchema = z.object({
  status: z.string().nullable().optional(),
  failedItemCount: z.number().nullable().optional(),
  items: z.array(batchItemSchema).optional(),
});

const filterResultSchema = z.object({
  totalElements: z.number().optional(),
  content: z.array(z.record(z.unknown())).optional(),
  nextPageToken: z.string().nullable().optional(),
});

/** Extrage id-urile atributelor din mesajele „Missing attribute Id: N”. */
function parseMissingAttributeIds(reasons: string[]): number[] {
  const ids: number[] = [];
  for (const r of reasons) {
    if (!r.startsWith(MISSING_ATTR_PREFIX)) continue;
    const m = MISSING_ATTR_RE.exec(r);
    if (m?.[1]) ids.push(Number(m[1]));
  }
  return ids;
}

@Injectable()
export class TrendyolReconcileWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly stockCodes: StockCodeService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;

    await this.queue.register<TrendyolReconcileBatchesJob>(TRENDYOL_RECONCILE_BATCHES_JOB, (data) =>
      this.reconcileBatches(data),
    );
    await this.queue.register<TrendyolReconcileApprovalJob>(
      TRENDYOL_RECONCILE_APPROVAL_JOB,
      (data) => this.reconcileApproval(data),
    );

    const plugin = await this.registry.findByPackageName(TRENDYOL_PACKAGE);
    if (!plugin) return;

    await this.queue
      .raw()
      .schedule(
        TRENDYOL_RECONCILE_BATCHES_JOB,
        BATCHES_CRON,
        { pluginId: plugin.id } satisfies TrendyolReconcileBatchesJob,
        { tz: 'UTC' },
      );
    await this.queue
      .raw()
      .schedule(
        TRENDYOL_RECONCILE_APPROVAL_JOB,
        APPROVAL_CRON,
        { pluginId: plugin.id } satisfies TrendyolReconcileApprovalJob,
        { tz: 'UTC' },
      );
    this.logger.log(
      { pluginId: plugin.id },
      'Trendyol reconcile scheduled (batches 2m, approval 2h)',
    );
  }

  // ─── Cron A: rezultatul batch-urilor + retry „Universal” ────────────────────

  async reconcileBatches(data: TrendyolReconcileBatchesJob): Promise<void> {
    const instance = await this.activeInstance(data.pluginId);
    if (!instance) return;

    const pending = await this.listings.listByPushState(data.pluginId, ['pending']);
    const byBatch = new Map<string, schema.Listing[]>();
    for (const l of pending) {
      const bid = l.syncState.batch_request_id;
      if (typeof bid !== 'string' || bid.length === 0) continue;
      const arr = byBatch.get(bid) ?? [];
      arr.push(l);
      byBatch.set(bid, arr);
    }

    for (const [batchRequestId, group] of byBatch) {
      const storeFrontCode = trendyolStorefrontFor(group[0]?.platform ?? '');
      let raw: unknown;
      try {
        raw = await invokeAction(instance, 'checkBatchRequest', {
          batchRequestId,
          ...(storeFrontCode ? { storeFrontCode } : {}),
        });
      } catch (err) {
        this.logger.warn({ batchRequestId, err: errMsg(err) }, 'Trendyol checkBatchRequest failed');
        continue;
      }
      const parsed = batchResultSchema.safeParse(raw);
      if (!parsed.success) continue;
      // IN_PROGRESS / corp all-null („neinițializat încă") → lăsăm pe tura următoare.
      if (parsed.data.status !== 'COMPLETED') continue;

      const contexts = await this.buildContexts(group);
      await this.applyBatchCompletion(instance, storeFrontCode, contexts, parsed.data);
    }
  }

  private async applyBatchCompletion(
    instance: Plugin,
    storeFrontCode: string | undefined,
    contexts: OfferContext[],
    result: z.infer<typeof batchResultSchema>,
  ): Promise<void> {
    const items = result.items ?? [];

    // Fără detaliu per-item: folosim failedItemCount ca semnal grosier.
    if (items.length === 0) {
      const allOk = (result.failedItemCount ?? 0) === 0;
      for (const ctx of contexts) {
        if (allOk) await this.markApprovalPending(ctx.listing);
        else
          await this.markPushFailed(ctx.listing, ['Trendyol batch eșuat (fără detalii per-item)']);
      }
      return;
    }

    const byStock = new Map<string, BatchItem>();
    const bySku = new Map<string, BatchItem>();
    const byBarcode = new Map<string, BatchItem>();
    for (const it of items) {
      const p = it.requestItem?.product;
      if (p?.stockCode) byStock.set(p.stockCode, it);
      if (p?.productMainId) bySku.set(p.productMainId, it);
      if (p?.barcode) byBarcode.set(p.barcode, it);
    }
    const findItem = (ctx: OfferContext): BatchItem | undefined =>
      byStock.get(String(ctx.stockCode)) ??
      bySku.get(ctx.product.sku) ??
      (ctx.product.ean ? byBarcode.get(ctx.product.ean) : undefined);

    const retry: { ctx: OfferContext; ids: number[] }[] = [];
    for (const ctx of contexts) {
      const it = findItem(ctx);
      if (!it) continue; // necunoscut → lăsăm pending, reverificăm tura următoare
      if (it.status === 'SUCCESS') {
        await this.markApprovalPending(ctx.listing);
        continue;
      }
      const reasons = it.failureReasons ?? [];
      const missingIds = parseMissingAttributeIds(reasons);
      const round = ctx.listing.syncState.retry_round ?? 0;
      if (missingIds.length > 0 && round < RETRY_ROUND_CAP) {
        const existing = ctx.listing.syncState.universal_attr_ids ?? [];
        const ids = [...new Set([...existing, ...missingIds])];
        retry.push({ ctx, ids });
      } else {
        await this.markPushFailed(ctx.listing, reasons);
      }
    }

    if (retry.length > 0) await this.submitRetryBatch(instance, storeFrontCode, retry);
  }

  /** Reasamblează ofertele cu „Universal” într-un SINGUR batch nou de createProduct. */
  private async submitRetryBatch(
    instance: Plugin,
    storeFrontCode: string | undefined,
    retry: { ctx: OfferContext; ids: number[] }[],
  ): Promise<void> {
    for (let i = 0; i < retry.length; i += TRENDYOL_BATCH) {
      const slice = retry.slice(i, i + TRENDYOL_BATCH);
      const items = slice.map(({ ctx, ids }) =>
        toTrendyolItemWithUniversalAttrs(
          { product: ctx.product, syncState: ctx.listing.syncState, stockCode: ctx.stockCode },
          ids,
        ),
      );
      let raw: unknown;
      try {
        raw = await invokeAction(instance, 'createProduct', {
          items,
          ...(storeFrontCode ? { storeFrontCode } : {}),
        });
      } catch (err) {
        // Lăsăm ofertele pending pe batch-ul curent (COMPLETED) → retry la tura următoare.
        this.logger.warn({ err: errMsg(err) }, 'Trendyol retry createProduct failed');
        continue;
      }
      const res = z.object({ batchRequestId: z.string().optional() }).safeParse(raw);
      const batchRequestId = res.success ? res.data.batchRequestId : undefined;
      if (!batchRequestId) {
        this.logger.warn('Trendyol retry createProduct fără batchRequestId');
        continue;
      }
      for (const { ctx, ids } of slice) {
        const next: schema.ListingSyncState = {
          ...ctx.listing.syncState,
          push_state: 'pending',
          batch_request_id: batchRequestId,
          retry_round: (ctx.listing.syncState.retry_round ?? 0) + 1,
          universal_attr_ids: ids,
          last_error: null,
        };
        delete next.push_failure_reasons;
        await this.listings.applyPushResult(ctx.listing.id, 'draft', next);
      }
    }
  }

  // ─── Cron B: urmărirea aprobării ─────────────────────────────────────────────

  async reconcileApproval(data: TrendyolReconcileApprovalJob): Promise<void> {
    const instance = await this.activeInstance(data.pluginId);
    if (!instance) return;

    const submitted = await this.listings.listByPushState(data.pluginId, [
      'submitted',
      'pending_approval',
    ]);
    if (submitted.length === 0) return;

    // filterProducts e per-storefront (nu per-listing) — o singură baleiere
    // paginată per storefront, în loc de un apel API per listing.
    const byStorefront = new Map<string | undefined, schema.Listing[]>();
    for (const listing of submitted) {
      const sf = trendyolStorefrontFor(listing.platform);
      const group = byStorefront.get(sf) ?? [];
      group.push(listing);
      byStorefront.set(sf, group);
    }

    for (const [storeFrontCode, listings] of byStorefront) {
      const unapprovedByStockCode = await this.fetchUnapprovedProducts(instance, storeFrontCode);
      // Baleierea a eșuat (rețea/parsare) — lăsăm listing-urile neschimbate, reîncercăm
      // la ciclul următor. NU le tratăm ca "aprobate" doar pentru că fetch-ul a picat.
      if (!unapprovedByStockCode) continue;

      for (const listing of listings) {
        const ctx = await this.buildContext(listing);
        const product = unapprovedByStockCode.get(String(ctx.stockCode));
        if (!product) {
          // Dispărut din /unapproved și nerejectat → aprobat & la vânzare.
          await this.markLive(listing, instance, ctx.stockCode, storeFrontCode);
          continue;
        }
        const reasons = extractRejectReasons(product);
        if (reasons.length > 0) await this.markRejected(listing, reasons);
        else await this.markApprovalConfirmed(listing);
      }
    }
  }

  /**
   * Baleiază `/products/unapproved` pentru un storefront, paginat prin cursor
   * (`nextPageToken` — obligatoriu peste 10.000 produse, unde `page*size` ar
   * depăși limita API-ului). Indexează după `stockCode` (fiecare variantă a
   * unui produs). Întoarce `null` dacă fetch-ul eșuează (rețea sau parsare).
   */
  private async fetchUnapprovedProducts(
    instance: Plugin,
    storeFrontCode: string | undefined,
  ): Promise<Map<string, TrendyolProduct> | null> {
    const byStockCode = new Map<string, TrendyolProduct>();
    let cursor: string | undefined;

    for (;;) {
      const input: Record<string, unknown> = { approved: false, size: 100 };
      if (storeFrontCode) input.storeFrontCode = storeFrontCode;
      if (cursor) input.nextPageToken = cursor;
      else input.page = 0;

      let raw: unknown;
      try {
        raw = await invokeAction(instance, 'filterProducts', input);
      } catch (err) {
        this.logger.warn(
          { storeFrontCode, err: errMsg(err) },
          'Trendyol reconcile: bulk filterProducts failed',
        );
        return null;
      }
      const parsed = filterResultSchema.safeParse(raw);
      if (!parsed.success) return null;

      const content = parsed.data.content ?? [];
      for (const item of content) {
        const product = item as unknown as TrendyolProduct;
        for (const variant of product.variants ?? []) {
          if (variant.stockCode) byStockCode.set(variant.stockCode, product);
        }
      }

      if (content.length === 0) break;
      cursor = parsed.data.nextPageToken ?? undefined;
      if (!cursor) break;
    }

    return byStockCode;
  }

  // ─── Helpers de stare ────────────────────────────────────────────────────────

  private async markApprovalPending(listing: schema.Listing): Promise<void> {
    const next: schema.ListingSyncState = {
      ...listing.syncState,
      push_state: 'submitted',
      approval_state: 'pending_approval',
      last_error: null,
    };
    delete next.push_failure_reasons;
    await this.listings.applyPushResult(listing.id, 'pending_approval', next);
  }

  private async markApprovalConfirmed(listing: schema.Listing): Promise<void> {
    await this.listings.applyPushResult(listing.id, 'pending_approval', {
      ...listing.syncState,
      push_state: 'pending_approval',
      approval_state: 'pending_approval',
    });
  }

  private async markLive(
    listing: schema.Listing,
    instance: Plugin,
    stockCode: number,
    storeFrontCode: string | undefined,
  ): Promise<void> {
    // Captăm contentId din feed-ul approved ca update-urile de conținut ulterioare
    // să folosească content-bulk-update (prin contentId), nu lookup-uri care dau 404.
    // Non-blocant: dacă nu-l găsim, marcăm tot live (ca înainte), fără trendyol_id.
    const contentId = await this.fetchApprovedContentId(instance, stockCode, storeFrontCode);
    const next: schema.ListingSyncState = {
      ...listing.syncState,
      push_state: 'live',
      approval_state: 'live',
      approved: true,
      last_error: null,
      ...(contentId !== null ? { trendyol_id: contentId } : {}),
    };
    delete next.push_failure_reasons;
    delete next.reject_reasons;
    await this.listings.applyPushResult(listing.id, 'active', next);
  }

  /** contentId din feed-ul approved pentru un stockCode; null dacă lipsește/eșuează. */
  private async fetchApprovedContentId(
    instance: Plugin,
    stockCode: number,
    storeFrontCode: string | undefined,
  ): Promise<number | null> {
    let raw: unknown;
    try {
      raw = await invokeAction(instance, 'filterProducts', {
        approved: true,
        stockCode: String(stockCode),
        size: 50,
        ...(storeFrontCode ? { storeFrontCode } : {}),
      });
    } catch {
      return null;
    }
    const parsed = filterResultSchema.safeParse(raw);
    const first = parsed.success ? parsed.data.content?.[0] : undefined;
    const contentId = first ? (first as { contentId?: unknown }).contentId : undefined;
    return typeof contentId === 'number' ? contentId : null;
  }

  private async markRejected(listing: schema.Listing, reasons: string[]): Promise<void> {
    await this.listings.applyPushResult(listing.id, 'rejected', {
      ...listing.syncState,
      push_state: 'rejected',
      approval_state: 'rejected',
      approved: false,
      reject_reasons: reasons,
      last_error: { message: reasons.join(' | '), at: new Date().toISOString() },
    });
  }

  private async markPushFailed(listing: schema.Listing, reasons: string[]): Promise<void> {
    const message = reasons.join(' | ') || 'Trendyol push eșuat';
    await this.listings.applyPushResult(listing.id, 'error', {
      ...listing.syncState,
      push_state: 'error',
      push_failure_reasons: reasons,
      last_error: { message, at: new Date().toISOString() },
    });
  }

  // ─── Utilitare ────────────────────────────────────────────────────────────────

  private async activeInstance(pluginId: string): Promise<Plugin | null> {
    const plugin = await this.registry.findById(pluginId);
    const loaded = this.loaded.getById(pluginId);
    if (plugin?.status !== 'active' || !loaded) return null;
    return loaded.instance;
  }

  private async buildContexts(listings: schema.Listing[]): Promise<OfferContext[]> {
    const out: OfferContext[] = [];
    for (const listing of listings) out.push(await this.buildContext(listing));
    return out;
  }

  private async buildContext(listing: schema.Listing): Promise<OfferContext> {
    const product = await this.products.get(listing.productId);
    const stockCode = await this.stockCodes.ensureForProduct(product.id);
    return { listing, product, stockCode };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
