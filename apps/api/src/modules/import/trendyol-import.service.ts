import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import { DomainError } from '../../errors/domain.error.js';
import { JobQueueService } from '../../jobs/job-queue.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { ProductsService } from '../products/products.service.js';

import { PUSH_OFFERS_JOB, type PushOffersJob } from './push-jobs.js';
import {
  mapStoreFrontToCurrency,
  toListingUpsert,
  toProductUpsert,
} from './trendyol-import.mapper.js';
import {
  TrendyolFilterOutputSchema,
  TrendyolProductSchema,
  type TrendyolImportDebugRecord,
  type TrendyolImportDebugReport,
  type TrendyolImportJobData,
  type TrendyolImportPlatformJob,
  type TrendyolImportProgress,
  type TrendyolPreviewItem,
  type TrendyolPreviewResult,
  type TrendyolProduct,
} from './trendyol-import.types.js';

const TRENDYOL_PACKAGE = '@opensales-plugin/trendyol';
const JOB_NAME = 'trendyol-import';
const PAGE_SIZE = 100; // Trendyol V2 products/approved allows up to size=100 (page*size ≤ 10000)
const PROGRESS_TTL_MS = 60 * 60 * 1000; // 1h
const PREVIEW_SAMPLE = 12; // produse aleatoare returnate de /preview
const PREVIEW_PAGE_SIZE = 50; // dimensiunea paginii folosite la sampling

interface ProgressEntry {
  progress: TrendyolImportProgress;
  updatedAt: number;
}

@Injectable()
export class TrendyolImportService implements OnApplicationBootstrap {
  private readonly progress = new Map<string, ProgressEntry>();
  /** Per-job debug records (storefront/contentId/outcome) — for diagnosing discrepancies. */
  private readonly debugRecords = new Map<string, TrendyolImportDebugRecord[]>();
  private handlerRegistered = false;

  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    if (this.handlerRegistered) return;
    this.handlerRegistered = true;
    await this.queue.register<TrendyolImportJobData>(JOB_NAME, (data) => this.runImport(data));
  }

  /**
   * Phase 1 — kick off an import. Verifies the plugin is active, derives
   * the total page count via a probe `filterProducts({ page: 0, size: 50 })`,
   * enqueues a pg-boss job and returns the jobId for status polling.
   */
  async startImport(): Promise<{ jobId: string; totalProducts: number; totalPages: number }> {
    const plugin = await this.registry.findByPackageName(TRENDYOL_PACKAGE);
    if (!plugin) {
      throw DomainError.validation(
        'Plugin Trendyol nu este instalat. Instalează plugin-ul înainte de import.',
      );
    }
    if (plugin.status !== 'active') {
      throw DomainError.validation(
        `Plugin Trendyol nu este activ (status: ${plugin.status}). Activează-l înainte de import.`,
      );
    }
    const loaded = this.loaded.getById(plugin.id);
    if (!loaded) {
      throw DomainError.validation('Plugin Trendyol nu este încărcat în memorie.');
    }

    // Determinăm storefront-urile active din config.enabledMarketplaces.
    // Dacă niciun cod 'trendyol-*' nu e configurat, folosim RO ca fallback.
    const cfg = plugin.config as {
      enabledMarketplaces?: string[];
      trendyolEasyCrossCountry?: boolean;
    } | null;
    const enabledMarketplaces = cfg?.enabledMarketplaces ?? [];
    const trendyolMarkets = enabledMarketplaces.filter((m) => m.startsWith('trendyol-'));
    const markets = trendyolMarkets.length > 0 ? trendyolMarkets : ['trendyol-ro'];
    const easyCrossCountry = cfg?.trendyolEasyCrossCountry === true;

    // Probe fiecare storefront pentru a afla totalPages.
    let totalProducts = 0;
    const platformJobs: TrendyolImportPlatformJob[] = [];

    for (const marketCode of markets) {
      const storeFrontCode = marketCode.replace('trendyol-', '').toUpperCase();
      const currency = mapStoreFrontToCurrency(storeFrontCode);
      const approvedProbe = TrendyolFilterOutputSchema.parse(
        await invokeAction(loaded.instance, 'filterProducts', {
          page: 0,
          size: 1,
          storeFrontCode,
        }),
      );
      // Unapproved is optional — some accounts/endpoints may not expose it.
      let unapprovedCount = 0;
      try {
        const unapprovedProbe = TrendyolFilterOutputSchema.parse(
          await invokeAction(loaded.instance, 'filterProducts', {
            page: 0,
            size: 1,
            approved: false,
            storeFrontCode,
          }),
        );
        unapprovedCount = unapprovedProbe.totalElements;
      } catch {
        unapprovedCount = 0;
      }
      const pageCount = (n: number): number => (n > 0 ? Math.ceil(n / PAGE_SIZE) : 1);
      const pages = pageCount(approvedProbe.totalElements) + pageCount(unapprovedCount);
      totalProducts += approvedProbe.totalElements + unapprovedCount;
      platformJobs.push({ storeFrontCode, platform: marketCode, totalPages: pages, currency });
    }

    const totalPages = platformJobs.reduce((m, j) => m + j.totalPages, 0);

    const jobId = uuidv7();
    const now = new Date().toISOString();
    this.cleanupStale();
    this.progress.set(jobId, {
      progress: {
        jobId,
        status: 'queued',
        currentPage: 0,
        totalPages,
        productsImported: 0,
        listingsImported: 0,
        skipped: 0,
        errors: [],
        startedAt: now,
      },
      updatedAt: Date.now(),
    });

    await this.queue.enqueue<TrendyolImportJobData>(JOB_NAME, {
      jobId,
      pluginId: plugin.id,
      platformJobs,
      easyCrossCountry,
    });

    this.logger.log(
      { jobId, totalProducts, totalPages, storefronts: markets },
      'Trendyol import enqueued',
    );
    return { jobId, totalProducts, totalPages };
  }

  getStatus(jobId: string): TrendyolImportProgress | null {
    this.cleanupStale();
    return this.progress.get(jobId)?.progress ?? null;
  }

  /** Pentru pagina de debug — doar numere, nu expune joburile brute. */
  getMemoryStats(): { activeJobs: number; bufferedErrors: number; debugRecords: number } {
    this.cleanupStale();
    let bufferedErrors = 0;
    for (const entry of this.progress.values()) bufferedErrors += entry.progress.errors.length;
    let debugRecords = 0;
    for (const records of this.debugRecords.values()) debugRecords += records.length;
    return { activeJobs: this.progress.size, bufferedErrors, debugRecords };
  }

  /**
   * Build a debug report for a finished/running import: per-storefront outcome
   * counts, distinct contentIds, how many contentIds appear under more than one
   * storefront (would collapse on a contentId-only listing key), and the full
   * record list (storefront/contentId/productMainId/barcode/outcome).
   */
  getDebug(jobId: string): TrendyolImportDebugReport | null {
    const records = this.debugRecords.get(jobId);
    if (!records) return null;
    const byStorefront: Record<
      string,
      { seen: number; imported: number; ignored: number; invalid: number }
    > = {};
    const contentIdStorefronts = new Map<number, Set<string>>();
    for (const r of records) {
      const b = (byStorefront[r.storefront] ??= {
        seen: 0,
        imported: 0,
        ignored: 0,
        invalid: 0,
      });
      b.seen++;
      b[r.outcome]++;
      if (r.contentId !== null) {
        const set = contentIdStorefronts.get(r.contentId) ?? new Set<string>();
        set.add(r.storefront);
        contentIdStorefronts.set(r.contentId, set);
      }
    }
    let crossStorefrontContentIds = 0;
    for (const set of contentIdStorefronts.values()) {
      if (set.size > 1) crossStorefrontContentIds++;
    }
    return {
      totalRecords: records.length,
      byStorefront,
      distinctContentIds: contentIdStorefronts.size,
      crossStorefrontContentIds,
      records,
    };
  }

  /**
   * Worker entry point. Iterates pages sequentially (0-indexed, per Trendyol
   * pagination), mapping each product to a product + listing upsert.
   * Per-item errors are recorded in `errors[]` without aborting the job;
   * only fatal errors (plugin unavailable) flip the job to `error`.
   */
  async runImport(data: TrendyolImportJobData): Promise<void> {
    const entry = this.progress.get(data.jobId);
    if (!entry) {
      this.logger.warn(
        { jobId: data.jobId },
        'Trendyol import job has no progress entry — skipping',
      );
      return;
    }
    entry.progress.status = 'running';
    entry.updatedAt = Date.now();
    const debug: TrendyolImportDebugRecord[] = [];
    this.debugRecords.set(data.jobId, debug);
    // EAN propagation: cross-border offers of the same product (same
    // productMainId) share one EAN. Cache the first non-null barcode seen and
    // reuse it for storefronts that return null (e.g. GR).
    const eanByMainId = new Map<string, string>();

    const loaded = this.loaded.getById(data.pluginId);
    if (!loaded) {
      entry.progress.status = 'error';
      entry.progress.errors.push({
        product_id: null,
        message: 'Plugin Trendyol nu este încărcat.',
      });
      entry.progress.finishedAt = new Date().toISOString();
      return;
    }

    for (const pj of data.platformJobs) {
      // Import both approved and unapproved products so pending/rejected items
      // (with their reasons) appear in the platform, not just live listings.
      for (const approved of [true, false] as const) {
        // V2 cursor pagination: start with page=0, then follow `nextPageToken`.
        // Falls back to classic page increment when the API returns no token, and
        // self-terminates on an empty page (no off-by-one vs. totalPages).
        let token: string | undefined;
        let pageIdx = 0;
        let fetched = 0;
        let total = Number.POSITIVE_INFINITY;
        let keepGoing = true;

        while (keepGoing) {
          entry.progress.currentPage++;
          entry.updatedAt = Date.now();
          try {
            const filterInput: Record<string, unknown> = {
              size: PAGE_SIZE,
              approved,
              storeFrontCode: pj.storeFrontCode,
            };
            if (token) filterInput.nextPageToken = token;
            else filterInput.page = pageIdx;

            const raw = TrendyolFilterOutputSchema.parse(
              await invokeAction(loaded.instance, 'filterProducts', filterInput),
            );
            total = raw.totalElements;

            for (const item of raw.content) {
              const parsed = TrendyolProductSchema.safeParse(item);
              if (!parsed.success) {
                const rawItem = item as { contentId?: unknown; productMainId?: unknown };
                entry.progress.errors.push({
                  product_id: typeof rawItem.contentId === 'number' ? rawItem.contentId : null,
                  message: `Validation failed: ${parsed.error.message}`,
                });
                debug.push({
                  storefront: pj.storeFrontCode,
                  approved,
                  contentId: typeof rawItem.contentId === 'number' ? rawItem.contentId : null,
                  productMainId:
                    typeof rawItem.productMainId === 'string' ? rawItem.productMainId : null,
                  barcode: null,
                  outcome: 'invalid',
                  error: parsed.error.message.slice(0, 300),
                });
                continue;
              }
              const product = parsed.data;
              const ownBarcode = product.variants[0]?.barcode ?? null;
              if (ownBarcode) eanByMainId.set(product.productMainId, ownBarcode);
              const effectiveBarcode = ownBarcode ?? eanByMainId.get(product.productMainId) ?? null;
              const debugBase = {
                storefront: pj.storeFrontCode,
                approved,
                contentId: product.contentId ?? null,
                productMainId: product.productMainId,
                barcode: effectiveBarcode,
              };
              try {
                // Link to an existing local product (by SKU/EAN). Unmatched
                // Trendyol products are skipped on purpose — we never create them.
                const matched = await this.matchProduct(product, effectiveBarcode);
                if (!matched) {
                  entry.progress.skipped++;
                  debug.push({ ...debugBase, outcome: 'ignored' });
                  continue;
                }
                // Non-RO storefronts are read-only mirrors when Easy Cross Country is on.
                const readOnly = (data.easyCrossCountry ?? false) && !pj.platform.endsWith('-ro');
                const listingInput = toListingUpsert(
                  product,
                  matched.id,
                  data.pluginId,
                  pj.platform,
                  pj.currency,
                  readOnly,
                );
                await this.listings.upsertByExternalId(listingInput);
                entry.progress.productsImported++;
                entry.progress.listingsImported++;
                debug.push({ ...debugBase, outcome: 'imported' });
              } catch (err) {
                entry.progress.errors.push({
                  product_id: product.contentId ?? null,
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }

            fetched += raw.content.length;
            pageIdx++;
            token = raw.nextPageToken ?? undefined;
            keepGoing = raw.content.length > 0 && (token !== undefined || fetched < total);
          } catch (err) {
            entry.progress.errors.push({
              product_id: null,
              message: `${pj.platform} ${approved ? 'approved' : 'unapproved'} (page ${pageIdx}): ${err instanceof Error ? err.message : String(err)}`,
            });
            keepGoing = false;
          }
        }
      }
    }

    entry.progress.status = 'done';
    entry.progress.finishedAt = new Date().toISOString();
    entry.updatedAt = Date.now();
    this.logger.log(
      {
        jobId: data.jobId,
        products: entry.progress.productsImported,
        listings: entry.progress.listingsImported,
        skipped: entry.progress.skipped,
        errors: entry.progress.errors.length,
      },
      'Trendyol import complete',
    );
  }

  /**
   * Returnează un eșantion aleatoriu de 12 produse răspândite uniform pe
   * întregul catalog Trendyol — nu doar primele produse din listă.
   *
   * Algoritm:
   *  1. Probe cu size=1 → obținem totalElements.
   *  2. Alegem PREVIEW_SAMPLE indici răspândiți uniform + jitter aleatoriu
   *     în intervalul [0, totalElements-1].
   *  3. Grupăm indicii pe pagini (PREVIEW_PAGE_SIZE) → minimizăm nr. de
   *     cereri API (de regulă 1-3 pagini).
   *  4. Mapăm fiecare produs și verificăm dacă există deja în platformă.
   */
  async getPreview(): Promise<TrendyolPreviewResult> {
    const plugin = await this.registry.findByPackageName(TRENDYOL_PACKAGE);
    if (!plugin) {
      throw DomainError.validation(
        'Plugin Trendyol nu este instalat. Instalează plugin-ul înainte de preview.',
      );
    }
    if (plugin.status !== 'active') {
      throw DomainError.validation(
        `Plugin Trendyol nu este activ (status: ${plugin.status}). Activează-l înainte de preview.`,
      );
    }
    const loaded = this.loaded.getById(plugin.id);
    if (!loaded) {
      throw DomainError.validation('Plugin Trendyol nu este încărcat în memorie.');
    }

    const enabledMarketplaces =
      (plugin.config as { enabledMarketplaces?: string[] } | null)?.enabledMarketplaces ?? [];
    // Preview uses the first configured storefront for sampling.
    const firstMarket = enabledMarketplaces.find((m) => m.startsWith('trendyol-')) ?? 'trendyol-ro';
    const previewStoreFront = firstMarket.replace('trendyol-', '').toUpperCase();
    const currency = mapStoreFrontToCurrency(previewStoreFront);

    // 1. Probe — aflăm totalElements fără a aduce date inutile
    const probe = TrendyolFilterOutputSchema.parse(
      await invokeAction(loaded.instance, 'filterProducts', {
        page: 0,
        size: 1,
        storeFrontCode: previewStoreFront,
      }),
    );

    if (probe.totalElements === 0) {
      throw DomainError.validation('Nu există produse în catalogul Trendyol.');
    }

    const total = probe.totalElements;
    const sampleCount = Math.min(PREVIEW_SAMPLE, total);

    // 2. Indici răspândiți uniform cu jitter
    const indices = this.pickSpreadIndices(total, sampleCount);

    // 3. Grupare pe pagini → număr minim de cereri API
    const pageMap = new Map<number, number[]>();
    for (const idx of indices) {
      const pageNum = Math.floor(idx / PREVIEW_PAGE_SIZE);
      const posInPage = idx % PREVIEW_PAGE_SIZE;
      const bucket = pageMap.get(pageNum) ?? [];
      bucket.push(posInPage);
      pageMap.set(pageNum, bucket);
    }

    // 4. Fetch pagini și extragere itemi
    const rawItems: unknown[] = [];
    for (const [pageNum, positions] of pageMap) {
      const result = TrendyolFilterOutputSchema.parse(
        await invokeAction(loaded.instance, 'filterProducts', {
          page: pageNum,
          size: PREVIEW_PAGE_SIZE,
          storeFrontCode: previewStoreFront,
        }),
      );
      for (const pos of positions) {
        if (result.content[pos] !== undefined) rawItems.push(result.content[pos]);
      }
    }

    // 5. Mapare la TrendyolPreviewItem
    const items: TrendyolPreviewItem[] = [];
    for (const raw of rawItems) {
      const parsed = TrendyolProductSchema.safeParse(raw);
      if (!parsed.success) continue;
      const productInput = toProductUpsert(parsed.data, currency);
      const matched = await this.matchProduct(parsed.data);
      items.push({
        raw,
        mapped: {
          sku: productInput.sku,
          name: productInput.name,
          priceAmountMinor: String(productInput.priceAmountMinor),
          priceCurrency: productInput.priceCurrency,
          stockQuantity: productInput.stockQuantity,
          brand: productInput.brand,
          ean: productInput.ean,
          vatRate: productInput.vatRate,
          imagesCount: productInput.images.length,
        },
        existing: matched ? { id: matched.id, sku: matched.sku, name: matched.name } : null,
        action: matched ? 'link_to_existing' : 'no_match',
      });
    }

    return { totalElements: total, items };
  }

  /**
   * Caută un produs existent în platformă care corespunde unui produs Trendyol.
   * Se încearcă 4 strategii în ordine; prima care găsește un rezultat câștigă.
   *
   *  1. SKU (al nostru) == productMainId (Trendyol)   — match direct
   *  2. EAN (al nostru) == barcode (Trendyol)         — match prin cod de bare
   *  3. EAN (al nostru) == productMainId (Trendyol)   — cross-check: poate
   *     furnizorul a pus productMainId ca EAN la ei
   *  4. SKU (al nostru) == barcode (Trendyol)         — cross-check: poate
   *     SKU-ul platformei e codul de bare Trendyol
   *
   * Dacă nicio strategie nu găsește produsul, returnează null → produsul e ignorat.
   */
  private async matchProduct(
    p: TrendyolProduct,
    barcodeOverride?: string | null,
  ): Promise<schema.Product | null> {
    // EAN can be propagated across storefronts (cross-border offers share the
    // same EAN); use the propagated barcode when this storefront's is null.
    const barcode = barcodeOverride ?? p.variants[0]?.barcode ?? null;

    // 1. SKU == productMainId
    const bySkuMain = await this.products.findBySku(p.productMainId);
    if (bySkuMain) return bySkuMain;

    // 2. EAN == barcode
    if (barcode) {
      const byEanBarcode = await this.products.findByEan(barcode);
      if (byEanBarcode) return byEanBarcode;
    }

    // 3. EAN == productMainId (cross-check)
    const byEanMain = await this.products.findByEan(p.productMainId);
    if (byEanMain) return byEanMain;

    // 4. SKU == barcode (cross-check)
    if (barcode) {
      const bySkuBarcode = await this.products.findBySku(barcode);
      if (bySkuBarcode) return bySkuBarcode;
    }

    return null;
  }

  /**
   * Alege `count` indici unici răspândiți uniform în intervalul [0, total-1],
   * cu un jitter aleatoriu per slot pentru a evita mereu aceleași produse.
   */
  private pickSpreadIndices(total: number, count: number): number[] {
    if (total <= count) return Array.from({ length: total }, (_, i) => i);
    const step = total / count;
    const indices = new Set<number>();
    for (let i = 0; i < count; i++) {
      const base = Math.floor(i * step);
      const jitter = Math.floor(Math.random() * step);
      indices.add(Math.min(base + jitter, total - 1));
    }
    // Completăm dacă jitter-ul a creat duplicate
    while (indices.size < count) {
      indices.add(Math.floor(Math.random() * total));
    }
    return [...indices];
  }

  async pushAll(pluginId: string): Promise<{ ok: boolean; queued: number }> {
    const plugin = await this.registry.findById(pluginId);
    if (plugin?.status !== 'active') {
      throw DomainError.validation('Plugin Trendyol inexistent sau inactiv.');
    }

    const config = plugin.config ?? {};
    const easyCrossCountry = config.trendyolEasyCrossCountry === true;
    const enabledMarketplaces = Array.isArray(config.enabledMarketplaces)
      ? config.enabledMarketplaces.filter((m): m is string => typeof m === 'string')
      : [];

    const targetPlatforms: string[] = easyCrossCountry
      ? ['trendyol-ro']
      : enabledMarketplaces.filter((m) => m.startsWith('trendyol-'));

    if (targetPlatforms.length === 0) {
      this.logger.warn({ pluginId }, 'Trendyol push-all: no target platforms');
      return { ok: true, queued: 0 };
    }

    const allListings = await this.listings.listAllByPlugin(pluginId);

    const byPlatform = new Map<string, string[]>();
    for (const listing of allListings) {
      if (!targetPlatforms.includes(listing.platform)) continue;
      const ids = byPlatform.get(listing.platform) ?? [];
      ids.push(listing.id);
      byPlatform.set(listing.platform, ids);
    }

    let queued = 0;
    for (const [marketplace, listingIds] of byPlatform) {
      await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, {
        pluginId,
        marketplace,
        listingIds,
      });
      queued += listingIds.length;
      this.logger.log(
        { pluginId, marketplace, count: listingIds.length },
        'Trendyol push-all: enqueued',
      );
    }

    return { ok: true, queued };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private cleanupStale(): void {
    const cutoff = Date.now() - PROGRESS_TTL_MS;
    for (const [id, entry] of this.progress) {
      if (entry.updatedAt < cutoff) {
        this.progress.delete(id);
        this.debugRecords.delete(id);
      }
    }
  }
}
