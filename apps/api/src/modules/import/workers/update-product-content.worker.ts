import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { type Plugin, invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { ListingsService } from '../../listings/listings.service.js';
import { trendyolStorefrontFor } from '../../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { ProductsService, type ProductWithListings } from '../../products/products.service.js';
import { StockCodeService } from '../../products/stock-code.service.js';
import {
  PUSH_OFFERS_JOB,
  UPDATE_PRODUCT_CONTENT_JOB,
  type PushOffersJob,
  type UpdateProductContentJob,
} from '../push-jobs.js';
import { toTrendyolItem } from '../push-offer.mapper.js';
import { TrendyolInventorySyncService } from '../trendyol-inventory-sync.service.js';

const TRENDYOL_BATCH = 1000;

interface ContentItem {
  contentId: number;
  title?: string;
  description?: string;
  images?: { url: string }[];
}

/** O ofertă + payload-ul construit pentru ea (pentru marcare per-listing la eșec). */
interface BuiltItem {
  listing: schema.Listing;
  item: Record<string, unknown> | ContentItem;
}

/** O ofertă Trendyol împreună cu produsul ei și câmpurile modificate (pt. agregare bulk). */
interface TrendyolEntry {
  listing: schema.Listing;
  product: ProductWithListings;
  changed: Set<string>;
  stockCode: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isEmag(platform: string): boolean {
  return platform.startsWith('emag-') || platform.startsWith('fd-');
}

function isTrendyol(platform: string): boolean {
  return platform.startsWith('trendyol-');
}

/**
 * Un Trendyol listing e tratat ca APROBAT doar dacă are un `contentId` stocat
 * (`syncState.trendyol_id`) — singura cheie cu care putem folosi content-bulk-update.
 * Pe Trendyol produsele neaprobate NU au contentId, deci absența lui = neaprobat;
 * astfel evităm complet lookup-urile către /products/approved care dau 404. ContentId-ul
 * e captat la import și la aprobare (reconcile markLive).
 */
function isApprovedTrendyol(listing: schema.Listing): boolean {
  return typeof listing.syncState.trendyol_id === 'number';
}

/**
 * Propagă modificări de CONȚINUT (din PATCH /products[/:id]) către ofertele de pe
 * marketplace-uri. Job-ul poate conține MAI MULTE produse — apelurile se AGREGĂ:
 *
 *  1) Suprascrie `syncState`-ul fiecărei oferte cu datele produsului (PATCH wins).
 *  2) Re-push, agregat peste toate produsele din job:
 *     - eMAG → un PUSH_OFFERS_JOB per (plugin, marketplace) cu TOATE listing-urile;
 *       PushOfferWorker le împarte în loturi de 50 (product_offer/save, stoc+conținut).
 *     - Trendyol NEAPROBAT → unapproved-bulk-update (stoc+conținut, barcode), loturi 1000.
 *     - Trendyol APROBAT → content-bulk-update (doar conținut, contentId), loturi 1000;
 *       stocul via UPDATE_STOCK_JOB, prețul via syncPrice (price-and-inventory).
 */
@Injectable()
export class UpdateProductContentWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly stockCodes: StockCodeService,
    private readonly trendyolSync: TrendyolInventorySyncService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<UpdateProductContentJob>(UPDATE_PRODUCT_CONTENT_JOB, (data) =>
      this.run(data),
    );
  }

  async run(job: UpdateProductContentJob): Promise<void> {
    const emagJobs = new Map<string, PushOffersJob>();
    const trendyolEntries: TrendyolEntry[] = [];

    for (const { productId, changedFields } of job.items) {
      const product = await this.products.get(productId);
      const allListings = await this.listings.listByProduct(productId);
      if (allListings.length === 0) continue;
      const changed = new Set(changedFields);

      // 1) Suprascrie syncState-ul ofertelor (eMAG + Trendyol) cu datele produsului.
      const updated = await this.overwriteSyncState(allListings, product, changed);

      // 2a) eMAG: agregă listing-urile per (plugin, marketplace) — pushEmag împarte 50.
      for (const listing of updated.filter((l) => isEmag(l.platform))) {
        const key = `${listing.pluginId}:${listing.platform}`;
        const existing = emagJobs.get(key);
        if (existing) existing.listingIds.push(listing.id);
        else
          emagJobs.set(key, {
            pluginId: listing.pluginId,
            marketplace: listing.platform,
            listingIds: [listing.id],
          });
      }

      // 2b) Trendyol: colectează ofertele pentru agregare după loop.
      const trendyolListings = updated.filter((l) => isTrendyol(l.platform));
      if (trendyolListings.length > 0) {
        const stockCode = await this.stockCodes.ensureForProduct(product.id);
        for (const listing of trendyolListings) {
          trendyolEntries.push({ listing, product, changed, stockCode });
        }
      }
    }

    // eMAG RO→BG→HU secvențial prin chain: BG pornește imediat ce RO termină,
    // HU imediat ce BG termină. fd-* și altele rămân independente.
    // eMAG RO rulează în paralel cu Trendyol RO (RO enqueue-uit, Trendyol RO direct/await).
    const EMAG_CHAIN_ORDER = ['emag-ro', 'emag-bg', 'emag-hu'];
    const allEmagValues = [...emagJobs.values()];
    const chainedEmag = EMAG_CHAIN_ORDER.map((m) =>
      allEmagValues.find((j) => j.marketplace === m),
    ).filter((j): j is PushOffersJob => j !== undefined);
    const otherEmag = allEmagValues.filter((j) => !EMAG_CHAIN_ORDER.includes(j.marketplace));

    let emagChain: PushOffersJob | undefined;
    for (const job of [...chainedEmag].reverse()) {
      emagChain = emagChain ? { ...job, afterComplete: emagChain } : job;
    }

    if (emagChain) await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, emagChain);
    for (const job of otherEmag) await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, job);

    // Trendyol RO direct (rulează în paralel cu eMAG RO care e în queue), apoi restul.
    await this.pushTrendyol(trendyolEntries.filter((e) => e.listing.platform === 'trendyol-ro'));
    await this.pushTrendyol(trendyolEntries.filter((e) => e.listing.platform !== 'trendyol-ro'));
  }

  /** Suprascrie câmpurile de conținut din syncState cu datele produsului (PATCH wins). */
  private async overwriteSyncState(
    listings: schema.Listing[],
    product: ProductWithListings,
    changed: Set<string>,
  ): Promise<schema.Listing[]> {
    const updated: schema.Listing[] = [];
    for (const listing of listings) {
      if (!isEmag(listing.platform) && !isTrendyol(listing.platform)) {
        updated.push(listing);
        continue;
      }
      const next: schema.ListingSyncState = { ...listing.syncState };
      if (changed.has('images')) next.images = product.images;
      if (changed.has('name')) next.title = product.name;
      if (changed.has('description')) next.description = product.description ?? undefined;
      // Stoc/preț au fallback la produs în mapper + worker-e light dedicate. Doar
      // REÎMPROSPĂTĂM un override per-ofertă existent (nu creăm unul nou), ca să nu
      // mascăm update-urile la nivel de produs și să nu suprascriem stocul light.
      if (changed.has('stockQuantity') && listing.syncState.stock_quantity !== undefined) {
        next.stock_quantity = product.stockQuantity;
      }
      if (changed.has('priceAmountMinor') && listing.syncState.price_amount_minor !== undefined) {
        next.price_amount_minor = String(product.priceAmountMinor);
      }
      updated.push(await this.listings.setSyncState(listing.id, next));
    }
    return updated;
  }

  /** Agregă ofertele Trendyol peste toate produsele și le trimite în loturi de 1000. */
  private async pushTrendyol(entries: TrendyolEntry[]): Promise<void> {
    if (entries.length === 0) return;

    interface Group {
      approved: boolean;
      storeFrontCode: string | undefined;
      pluginId: string;
      entries: TrendyolEntry[];
    }
    const groups = new Map<string, Group>();
    for (const entry of entries) {
      const approved = isApprovedTrendyol(entry.listing);
      const storeFrontCode = trendyolStorefrontFor(entry.listing.platform);
      const key = `${approved ? 'a' : 'u'}:${storeFrontCode ?? ''}:${entry.listing.pluginId}`;
      const group = groups.get(key);
      if (group) group.entries.push(entry);
      else
        groups.set(key, {
          approved,
          storeFrontCode,
          pluginId: entry.listing.pluginId,
          entries: [entry],
        });
    }

    for (const group of groups.values()) {
      const loaded = this.loaded.getById(group.pluginId);
      if (!loaded) continue;

      if (group.approved) {
        const { content, fallback } = this.buildApprovedItems(group.entries);
        await this.submitBatches(
          loaded.instance,
          'updateApprovedContent',
          content,
          group.storeFrontCode,
        );
        // Aprobate fără contentId (Trendyol nu le are în feed-ul approved → 404):
        // le trimitem prin unapproved-bulk-update (barcode) ca să ajungă oricum.
        if (fallback.length > 0) {
          await this.submitBatches(
            loaded.instance,
            'updateUnapprovedProduct',
            this.buildUnapprovedItems(fallback),
            group.storeFrontCode,
          );
        }
      } else {
        await this.submitBatches(
          loaded.instance,
          'updateUnapprovedProduct',
          this.buildUnapprovedItems(group.entries),
          group.storeFrontCode,
        );
      }
    }

    // Prețul aprobatelor NU poate merge prin content-bulk-update → price-and-inventory
    // (ECC-aware, fără re-aprobare). O dată per produs care a schimbat prețul.
    const pricedProducts = new Map<string, ProductWithListings>();
    for (const entry of entries) {
      const priceChanged =
        entry.changed.has('priceAmountMinor') || entry.changed.has('fullPriceAmountMinor');
      if (priceChanged && isApprovedTrendyol(entry.listing)) {
        pricedProducts.set(entry.product.id, entry.product);
      }
    }
    for (const product of pricedProducts.values()) {
      try {
        await this.trendyolSync.syncPrice(product);
      } catch (err) {
        this.logger.warn(
          { productId: product.id, err: err instanceof Error ? err.message : String(err) },
          'trendyol approved price sync failed',
        );
      }
    }
  }

  /**
   * Items pentru content-bulk-update (aprobate): doar câmpurile de conținut modificate.
   * contentId vine din `syncState.trendyol_id` (garantat de isApprovedTrendyol). Dacă
   * lipsește totuși, oferta merge în `fallback` (unapproved-bulk-update prin barcode).
   */
  private buildApprovedItems(entries: TrendyolEntry[]): {
    content: BuiltItem[];
    fallback: TrendyolEntry[];
  } {
    const content: BuiltItem[] = [];
    const fallback: TrendyolEntry[] = [];
    for (const entry of entries) {
      const { listing, product, changed } = entry;
      const contentId = listing.syncState.trendyol_id;
      if (typeof contentId !== 'number') {
        fallback.push(entry);
        continue;
      }
      const ss = listing.syncState;
      const item: ContentItem = { contentId };
      if (changed.has('name')) item.title = (ss.title ?? product.name).slice(0, 100);
      if (changed.has('description')) {
        const desc = ss.description ?? product.description;
        if (desc) item.description = String(desc);
      }
      if (changed.has('images')) {
        const imgs = (ss.images ?? product.images ?? []).map((i) => ({ url: i.url }));
        // content-bulk-update e partial: o galerie goală e invalidă (.min(1)) și nu poate
        // exprima ștergerea imaginilor — omitem câmpul când nu avem imagini.
        if (imgs.length > 0) item.images = imgs;
      }
      if (item.title === undefined && item.description === undefined && item.images === undefined) {
        continue;
      }
      content.push({ listing, item });
    }
    return { content, fallback };
  }

  /** Items pentru unapproved-bulk-update (full, prin barcode). Sare ofertele fără imagini. */
  private buildUnapprovedItems(entries: TrendyolEntry[]): BuiltItem[] {
    const built: BuiltItem[] = [];
    for (const { listing, product, stockCode } of entries) {
      const item = toTrendyolItem({ product, syncState: listing.syncState, stockCode });
      const imgs = item.images;
      if (!Array.isArray(imgs) || imgs.length === 0) {
        this.logger.warn(
          { listingId: listing.id, productId: product.id },
          'trendyol unapproved update skipped — fără imagini',
        );
        continue;
      }
      built.push({ listing, item });
    }
    return built;
  }

  /** Trimite items în loturi de max 1000; la eșec, marchează ofertele cu last_error. */
  private async submitBatches(
    instance: Plugin,
    action: string,
    built: BuiltItem[],
    storeFrontCode: string | undefined,
  ): Promise<void> {
    if (built.length === 0) return;
    for (const batch of chunk(built, TRENDYOL_BATCH)) {
      try {
        await invokeAction(instance, action, {
          items: batch.map((b) => b.item),
          ...(storeFrontCode ? { storeFrontCode } : {}),
        });
        this.logger.log(
          { action, storeFrontCode, count: batch.length },
          'trendyol content update submitted',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          { action, storeFrontCode, err: message },
          'trendyol content update failed',
        );
        await this.markListingsError(
          batch.map((b) => b.listing),
          action,
          message,
        );
      }
    }
  }

  /** Scrie `last_error` pe oferte (păstrând status-ul) ca eșecul să fie vizibil în UI. */
  private async markListingsError(
    listings: schema.Listing[],
    action: string,
    message: string,
  ): Promise<void> {
    for (const listing of listings) {
      try {
        await this.listings.setSyncState(listing.id, {
          ...listing.syncState,
          last_error: { message: `${action}: ${message}`, at: new Date().toISOString() },
        });
      } catch {
        // marcarea erorii nu trebuie să rupă jobul
      }
    }
  }
}
