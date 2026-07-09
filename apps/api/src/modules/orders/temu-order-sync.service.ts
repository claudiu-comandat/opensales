import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../jobs/job-queue.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';

import {
  collectSkuCandidatesFromDetail,
  mapTemuOrderToDb,
  type TemuOrderDetail,
  type TemuOrderListItem,
  type TemuShippingInfo,
} from './temu-order-sync.mapper.js';

const TEMU_PACKAGE = '@opensales-plugin/temu';
const SYNC_JOB = 'temu-order-sync';
const SYNC_CRON = '0 * * * *';
const PAGE_SIZE = 100;

const CURRENCY_MAP: Record<string, string> = {
  'temu-eu': 'EUR',
  'temu-us': 'USD',
  'temu-global': 'GBP',
};

interface SyncJobData {
  pluginId: string;
  updateTimeStart?: number;
}

interface SyncOrdersOutput {
  orders: TemuOrderListItem[];
  total?: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class TemuOrderSyncService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly queue: JobQueueService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<SyncJobData>(SYNC_JOB, (data) =>
      this.runSync(data.pluginId, data.updateTimeStart),
    );

    const plugin = await this.registry.findByPackageName(TEMU_PACKAGE);
    if (!plugin) return;

    await this.scheduleHourlySync(plugin.id);

    await this.queue.enqueue<SyncJobData>(SYNC_JOB, { pluginId: plugin.id }, { startAfter: 15 });
    this.logger.log({ pluginId: plugin.id }, 'Temu order sync triggered on startup');
  }

  async scheduleHourlySync(pluginId: string): Promise<void> {
    await this.queue.raw().schedule(SYNC_JOB, SYNC_CRON, { pluginId } satisfies SyncJobData, {
      tz: 'UTC',
    });
    this.logger.log({ pluginId }, 'Temu order sync scheduled (hourly)');
  }

  /**
   * Enqueue an immediate sync job. Returns the Temu pluginId, or null if the
   * plugin is not installed. The job runs asynchronously via pg-boss.
   */
  async triggerImmediateSync(options?: {
    sinceHours?: number;
  }): Promise<{ pluginId: string; updateTimeStart?: number } | null> {
    const plugin = await this.registry.findByPackageName(TEMU_PACKAGE);
    if (!plugin) return null;

    const updateTimeStart =
      options?.sinceHours !== undefined
        ? Math.floor((Date.now() - options.sinceHours * 60 * 60 * 1000) / 1000)
        : undefined;

    const data: SyncJobData = { pluginId: plugin.id };
    if (updateTimeStart !== undefined) data.updateTimeStart = updateTimeStart;

    await this.queue.enqueue<SyncJobData>(SYNC_JOB, data);
    this.logger.log({ pluginId: plugin.id, updateTimeStart }, 'Temu order sync triggered manually');
    return updateTimeStart !== undefined
      ? { pluginId: plugin.id, updateTimeStart }
      : { pluginId: plugin.id };
  }

  async runSync(pluginId: string, updateTimeStart?: number): Promise<void> {
    const plugin = await this.registry.findById(pluginId);
    if (plugin?.status !== 'active') return;

    const loaded = this.loaded.getById(pluginId);
    if (!loaded) {
      this.logger.warn({ pluginId }, 'Temu plugin not loaded — skipping sync');
      return;
    }

    const currency = this.resolveCurrency(plugin);
    let page = 1;
    let synced = 0;

    this.logger.log({ pluginId, updateTimeStart }, 'Temu order sync started');

    do {
      const syncInput: Record<string, unknown> = {
        page,
        pageSize: PAGE_SIZE,
      };
      if (updateTimeStart !== undefined) syncInput.updateTimeStart = updateTimeStart;

      const result = (await invokeAction(
        loaded.instance,
        'syncOrders',
        syncInput,
      )) as SyncOrdersOutput;

      for (const listItem of result.orders) {
        const parentOrderSn = listItem.parentOrderSn as string;
        try {
          const existingId = await this.orderExistsInDb(pluginId, parentOrderSn);

          if (existingId !== null) {
            const status = (listItem.status as number | undefined) ?? 0;
            const mappedStatus =
              (
                {
                  1: 'new',
                  2: 'processing',
                  3: 'cancelled',
                  4: 'shipped',
                  5: 'delivered',
                } as Record<number, string>
              )[status] ?? 'new';
            await this.updateOrderStatus(existingId, mappedStatus);
          } else {
            const detail = (await invokeAction(loaded.instance, 'getOrderDetail', {
              parentOrderSn,
            })) as TemuOrderDetail;

            const shipping = (await invokeAction(loaded.instance, 'getShippingInfo', {
              parentOrderSn,
            })) as TemuShippingInfo;

            const skus = collectSkuCandidatesFromDetail(detail);
            const productIdBySku = await this.resolveProductIds(skus);

            const { order: mapped, items } = mapTemuOrderToDb(
              listItem,
              detail,
              shipping,
              pluginId,
              currency,
              productIdBySku,
            );

            await this.db.transaction(async (tx) => {
              await tx
                .insert(schema.orders)
                .values({ ...mapped, rawPayload: { list: listItem, detail, shipping } });
              if (items.length > 0) {
                await tx.insert(schema.orderItems).values(items);
              }
            });
          }

          synced++;
        } catch (err) {
          this.logger.error({ pluginId, parentOrderSn, err }, 'failed to upsert Temu order');
        }
      }

      if (result.orders.length < PAGE_SIZE) break;
      page++;
    } while (page > 0);

    this.logger.log({ pluginId, synced }, 'Temu order sync completed');
  }

  private async orderExistsInDb(pluginId: string, parentOrderSn: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.pluginId, pluginId), eq(schema.orders.externalId, parentOrderSn)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  private async updateOrderStatus(orderId: string, status: string): Promise<void> {
    await this.db
      .update(schema.orders)
      .set({ status: status as schema.Order['status'], updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));
  }

  private async resolveProductIds(skus: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = Array.from(new Set(skus.filter((s) => s.length > 0)));
    if (unique.length === 0) return out;
    const rows = await this.db
      .select({ id: schema.products.id, sku: schema.products.sku })
      .from(schema.products)
      .where(inArray(schema.products.sku, unique));
    for (const row of rows) out.set(row.sku, row.id);
    return out;
  }

  private resolveCurrency(plugin: { config?: unknown }): string {
    try {
      const enabledMarketplaces =
        (plugin.config as { enabledMarketplaces?: string[] } | null)?.enabledMarketplaces ?? [];
      for (const code of enabledMarketplaces) {
        if (CURRENCY_MAP[code]) return CURRENCY_MAP[code];
      }
    } catch {
      // fall through
    }
    return 'EUR';
  }
}
