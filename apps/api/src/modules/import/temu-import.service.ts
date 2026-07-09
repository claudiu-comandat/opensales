import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import { DomainError } from '../../errors/domain.error.js';
import { JobQueueService } from '../../jobs/job-queue.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { ProductsService } from '../products/products.service.js';

import {
  mapTemuPlatformToCurrency,
  toListingUpsert,
  toProductUpsert,
} from './temu-import.mapper.js';

import type { TemuImportJobData, TemuImportProgress } from './temu-import.types.js';

const TEMU_PACKAGE = '@opensales-plugin/temu';
const JOB_NAME = 'temu-import';
const PAGE_SIZE = 100;
const PROGRESS_TTL_MS = 60 * 60 * 1000; // 1h

interface ProgressEntry {
  progress: TemuImportProgress;
  updatedAt: number;
}

@Injectable()
export class TemuImportService implements OnApplicationBootstrap {
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
    await this.queue.register<TemuImportJobData>(JOB_NAME, (data) => this.runImport(data));
  }

  /**
   * Phase 1 — kick off an import. Verifies the plugin is active, derives
   * the total page count via a probe `syncGoods({ page: 1, pageSize: 1 })`,
   * enqueues a pg-boss job and returns the jobId for status polling.
   */
  async startImport(): Promise<{ jobId: string; totalProducts: number; totalPages: number }> {
    const plugin = await this.registry.findByPackageName(TEMU_PACKAGE);
    if (!plugin) {
      throw DomainError.validation(
        'Plugin Temu nu este instalat. Instalează plugin-ul înainte de import.',
      );
    }
    if (plugin.status !== 'active') {
      throw DomainError.validation(
        `Plugin Temu nu este activ (status: ${plugin.status}). Activează-l înainte de import.`,
      );
    }
    const loaded = this.loaded.getById(plugin.id);
    if (!loaded) {
      throw DomainError.validation('Plugin Temu nu este încărcat în memorie.');
    }

    const enabledMarketplaces =
      (plugin.config as { enabledMarketplaces?: string[] } | null)?.enabledMarketplaces ?? [];
    const platform = this.resolvePlatformFromMarketplaces(enabledMarketplaces);
    const currency = mapTemuPlatformToCurrency(platform);

    // Probe with pageSize=1 to get total without fetching a full page.
    const probe = (await invokeAction(loaded.instance, 'syncGoods', {
      page: 1,
      pageSize: 1,
    })) as { goodsInfoList: unknown[]; total?: number; page: number; pageSize: number };

    const totalProducts = probe.total ?? 0;
    const totalPages = totalProducts > 0 ? Math.ceil(totalProducts / PAGE_SIZE) : 1;

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

    await this.queue.enqueue<TemuImportJobData>(JOB_NAME, {
      jobId,
      pluginId: plugin.id,
      totalPages,
      platform,
      currency,
    });

    this.logger.log({ jobId, totalProducts, totalPages }, 'Temu import enqueued');
    return { jobId, totalProducts, totalPages };
  }

  getStatus(jobId: string): TemuImportProgress | null {
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
   * Worker entry point. Iterates pages sequentially (1-indexed, per Temu pagination),
   * mapping each goods item to a product + listing upsert.
   * Per-item errors are recorded in `errors[]` without aborting the job;
   * only fatal errors (plugin unavailable) flip the job to `error`.
   */
  async runImport(data: TemuImportJobData): Promise<void> {
    const entry = this.progress.get(data.jobId);
    if (!entry) {
      this.logger.warn({ jobId: data.jobId }, 'Temu import job has no progress entry — skipping');
      return;
    }
    entry.progress.status = 'running';
    entry.updatedAt = Date.now();

    const loaded = this.loaded.getById(data.pluginId);
    if (!loaded) {
      entry.progress.status = 'error';
      entry.progress.errors.push({
        goods_id: null,
        message: 'Plugin Temu nu este încărcat.',
      });
      entry.progress.finishedAt = new Date().toISOString();
      return;
    }

    const currency = data.currency ?? 'EUR';
    const platform = data.platform ?? 'temu-eu';

    for (let page = 1; page <= data.totalPages; page++) {
      entry.progress.currentPage = page;
      entry.updatedAt = Date.now();
      try {
        const raw = (await invokeAction(loaded.instance, 'syncGoods', {
          page,
          pageSize: PAGE_SIZE,
        })) as { goodsInfoList: unknown[]; total?: number; page: number; pageSize: number };

        const goodsInfoList = Array.isArray(raw.goodsInfoList) ? raw.goodsInfoList : [];

        for (const rawItem of goodsInfoList) {
          const item = rawItem as Record<string, unknown>;

          // Validate required fields
          if (typeof item.goodsId !== 'number' || typeof item.goodsName !== 'string') {
            entry.progress.skipped++;
            continue;
          }

          const goodsId = item.goodsId;
          try {
            const productInput = toProductUpsert(item, currency);
            const upserted = await this.products.upsertBySku(productInput);

            const listingInput = toListingUpsert(
              item,
              upserted.id,
              data.pluginId,
              platform,
              currency,
            );
            await this.listings.upsertByExternalId(listingInput);

            entry.progress.productsImported++;
            entry.progress.listingsImported++;
          } catch (err) {
            entry.progress.errors.push({
              goods_id: goodsId,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        entry.progress.errors.push({
          goods_id: null,
          message: `Page ${page}: ${err instanceof Error ? err.message : String(err)}`,
        });
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
      'Temu import complete',
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Derives the platform from the `enabledMarketplaces` plugin config.
   * Returns the first code starting with 'temu-', or 'temu-eu' as default.
   */
  private resolvePlatformFromMarketplaces(enabledMarketplaces: string[]): string {
    for (const code of enabledMarketplaces) {
      if (code.startsWith('temu-')) {
        return code;
      }
    }
    return 'temu-eu';
  }

  private cleanupStale(): void {
    const cutoff = Date.now() - PROGRESS_TTL_MS;
    for (const [id, entry] of this.progress) {
      if (entry.updatedAt < cutoff) this.progress.delete(id);
    }
  }
}
