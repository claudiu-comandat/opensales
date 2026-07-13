import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { invokeAction, type Plugin } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import { DomainError } from '../../errors/domain.error.js';
import { JobQueueService } from '../../jobs/job-queue.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { ProductsService } from '../products/products.service.js';

import { mapPlatformToCurrency, toListingUpsert, toProductUpsert } from './emag-import.mapper.js';
import {
  EmagOfferReadItemSchema,
  EmagSyncOffersOutputSchema,
  EmagVatRateItemSchema,
  type EmagImportJobData,
  type EmagImportProgress,
} from './emag-import.types.js';

const EMAG_PACKAGE = '@opensales-plugin/emag';
const JOB_NAME = 'emag-import';
const PAGE_SIZE = 100;
const PROGRESS_TTL_MS = 60 * 60 * 1000; // 1h

interface ProgressEntry {
  progress: EmagImportProgress;
  updatedAt: number;
}

@Injectable()
export class EmagImportService implements OnApplicationBootstrap {
  private readonly progress = new Map<string, ProgressEntry>();
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
    await this.queue.register<EmagImportJobData>(JOB_NAME, (data) => this.runImport(data));
  }

  /**
   * Phase 1 — kick off an import. Verifies the plugin is active, derives
   * the total page count via `syncOffers({ currentPage: 1, includeCount: true })`,
   * enqueues a pg-boss job and returns the jobId for status polling.
   */
  async startImport(): Promise<{ jobId: string; totalProducts: number; totalPages: number }> {
    const plugin = await this.registry.findByPackageName(EMAG_PACKAGE);
    if (!plugin) {
      throw DomainError.validation(
        'Plugin eMAG nu este instalat. Instalează plugin-ul înainte de import.',
      );
    }
    if (plugin.status !== 'active') {
      throw DomainError.validation(
        `Plugin eMAG nu este activ (status: ${plugin.status}). Activează-l înainte de import.`,
      );
    }
    const loaded = this.loaded.getById(plugin.id);
    if (!loaded) {
      throw DomainError.validation('Plugin eMAG nu este încărcat în memorie.');
    }

    const platforms = this.resolvePlatformsFromConfig(plugin.config);
    let totalProducts = 0;
    const platformJobs: { platform: string; totalPages: number }[] = [];
    for (const platform of platforms) {
      const probe = EmagSyncOffersOutputSchema.parse(
        await invokeAction(loaded.instance, 'syncOffers', {
          currentPage: 1,
          itemsPerPage: PAGE_SIZE,
          includeCount: true,
          platform,
        }),
      );
      const pp = probe.total ?? probe.items.length;
      const tp = probe.pages ?? (pp > 0 ? Math.ceil(pp / PAGE_SIZE) : 1);
      totalProducts += pp;
      platformJobs.push({ platform, totalPages: tp });
    }
    const totalPages = platformJobs.reduce((s, j) => s + j.totalPages, 0);

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
        errors: [],
        startedAt: now,
      },
      updatedAt: Date.now(),
    });

    await this.queue.enqueue<EmagImportJobData>(JOB_NAME, {
      jobId,
      pluginId: plugin.id,
      platformJobs,
    });

    this.logger.log({ jobId, totalProducts, totalPages }, 'eMAG import enqueued');
    return { jobId, totalProducts, totalPages };
  }

  getStatus(jobId: string): EmagImportProgress | null {
    this.cleanupStale();
    return this.progress.get(jobId)?.progress ?? null;
  }

  /** Pentru pagina de debug — doar numere, nu expune joburile brute. */
  getMemoryStats(): { activeJobs: number; bufferedErrors: number } {
    this.cleanupStale();
    let bufferedErrors = 0;
    for (const entry of this.progress.values()) bufferedErrors += entry.progress.errors.length;
    return { activeJobs: this.progress.size, bufferedErrors };
  }

  /**
   * Worker entry point. Iterates pages sequentially, mapping each offer to a
   * product + listing upsert. Per-offer errors are recorded in `errors[]`
   * without aborting the job; only fatal errors (plugin unavailable) flip
   * the job to `error`.
   */
  async runImport(data: EmagImportJobData): Promise<void> {
    const entry = this.progress.get(data.jobId);
    if (!entry) {
      this.logger.warn({ jobId: data.jobId }, 'eMAG import job has no progress entry — skipping');
      return;
    }
    entry.progress.status = 'running';
    entry.updatedAt = Date.now();

    const loaded = this.loaded.getById(data.pluginId);
    if (!loaded) {
      entry.progress.status = 'error';
      entry.progress.errors.push({ offer_id: null, message: 'Plugin eMAG nu este încărcat.' });
      entry.progress.finishedAt = new Date().toISOString();
      return;
    }

    const vatLookup = await this.buildVatLookup(loaded.instance);
    let globalPage = 0;
    const totalPages = data.platformJobs.reduce((s, j) => s + j.totalPages, 0);

    // Process RO platforms (emag-ro / fd-ro) first so their data wins on the
    // principal product and is cached as image fallback for HU/BG offers that
    // ship without their own images.
    const orderedJobs = [...data.platformJobs].sort((a, b) => {
      const aRo = a.platform.endsWith('-ro') ? 0 : 1;
      const bRo = b.platform.endsWith('-ro') ? 0 : 1;
      return aRo - bRo;
    });

    // RO reference data, keyed by EAN (the cross-country product identity).
    const roImagesByEan = new Map<string, { url: string }[]>();
    const roClaimedSkus = new Set<string>();

    for (const { platform, totalPages: platformPages } of orderedJobs) {
      const isRo = platform.endsWith('-ro');
      const currency = mapPlatformToCurrency(platform);
      for (let page = 1; page <= platformPages; page++) {
        globalPage++;
        entry.progress.currentPage = globalPage;
        entry.progress.totalPages = totalPages;
        entry.updatedAt = Date.now();
        try {
          const raw = EmagSyncOffersOutputSchema.parse(
            await invokeAction(loaded.instance, 'syncOffers', {
              currentPage: page,
              itemsPerPage: PAGE_SIZE,
              platform,
            }),
          );
          for (const item of raw.items) {
            const parsed = EmagOfferReadItemSchema.safeParse(item);
            if (!parsed.success) {
              entry.progress.errors.push({
                offer_id:
                  typeof (item as { id?: unknown }).id === 'number'
                    ? (item as { id: number }).id
                    : null,
                message: `Validation failed: ${parsed.error.message}`,
              });
              continue;
            }
            const offer = parsed.data;
            try {
              const vatRate = vatLookup.get(offer.vat_id) ?? null;
              // Image fallback: borrow the RO offer's images (same EAN) when
              // this offer ships none. Only images — never title/description.
              const ownImages = offer.images.map((img) => ({ url: img.url }));
              const fallbackImages =
                ownImages.length === 0 ? this.lookupRoImages(offer.ean, roImagesByEan) : [];

              const productInput = toProductUpsert(offer, currency, vatRate, fallbackImages);
              const sku = productInput.sku;
              // RO data wins on the principal: RO offers always upsert; non-RO
              // offers don't overwrite a product already claimed by an RO offer.
              const product =
                isRo || !roClaimedSkus.has(sku)
                  ? await this.products.upsertBySku(productInput)
                  : await this.products.findOrCreateBySku(productInput);

              const listingInput = toListingUpsert(
                offer,
                product.id,
                data.pluginId,
                platform,
                currency,
                fallbackImages,
              );
              await this.listings.upsertByExternalId(listingInput);

              if (isRo) {
                roClaimedSkus.add(sku);
                if (ownImages.length > 0) {
                  for (const ean of offer.ean) roImagesByEan.set(ean, ownImages);
                }
              }

              entry.progress.productsImported++;
              entry.progress.listingsImported++;
            } catch (err) {
              entry.progress.errors.push({
                offer_id: offer.id,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } catch (err) {
          entry.progress.errors.push({
            offer_id: null,
            message: `Page ${page} (${platform}): ${err instanceof Error ? err.message : String(err)}`,
          });
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
        errors: entry.progress.errors.length,
      },
      'eMAG import complete',
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Look up cached RO offer images by any of an offer's EANs. */
  private lookupRoImages(
    eans: string[] | undefined,
    roImagesByEan: Map<string, { url: string }[]>,
  ): { url: string }[] {
    for (const ean of eans ?? []) {
      const imgs = roImagesByEan.get(ean);
      if (imgs && imgs.length > 0) return imgs;
    }
    return [];
  }

  /**
   * Derivă lista de platforme eMAG active din `config.enabledMarketplaces`.
   * Filtrează doar codurile relevante (emag-ro/bg/hu, fd-ro/fd-bg).
   * Dacă lista e goală sau plugin-ul nu are config, fallback la `['emag-ro']`.
   */
  private resolvePlatformsFromConfig(config: unknown): string[] {
    const EMAG_PREFIXES = ['emag-', 'fd-'];
    const enabledMarketplaces =
      (config as { enabledMarketplaces?: string[] } | null)?.enabledMarketplaces ?? [];
    const emagPlatforms = enabledMarketplaces.filter((code) =>
      EMAG_PREFIXES.some((pfx) => code.startsWith(pfx)),
    );
    return emagPlatforms.length > 0 ? emagPlatforms : ['emag-ro'];
  }

  /**
   * Try to read the VAT nomenclator via the plugin's `readVatRates` action
   * (eMAG `vat/read`, response shaped `{ rates: [...] }`, items shaped
   * `{ id, value }` with `value` a decimal fraction — 0.19 for 19%). If the
   * plugin doesn't expose it, return an empty lookup — products will be created
   * with `vatRate = null` and can be enriched later. Lookup maps id → percent
   * integer (0, 19, 21…), matching `products.vatRate`.
   */
  private async buildVatLookup(instance: Plugin): Promise<Map<number, number>> {
    const lookup = new Map<number, number>();
    if (!instance._actions?.readVatRates) return lookup;
    try {
      const raw = await invokeAction(instance, 'readVatRates', {});
      const items = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { rates?: unknown[] }).rates)
          ? (raw as { rates: unknown[] }).rates
          : [];
      for (const it of items) {
        const parsed = EmagVatRateItemSchema.safeParse(it);
        if (parsed.success) lookup.set(parsed.data.id, Math.round(parsed.data.value * 100));
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'readVatRates failed — proceeding without VAT lookup',
      );
    }
    return lookup;
  }

  private cleanupStale(): void {
    const cutoff = Date.now() - PROGRESS_TTL_MS;
    for (const [id, entry] of this.progress) {
      if (entry.updatedAt < cutoff) this.progress.delete(id);
    }
  }
}
