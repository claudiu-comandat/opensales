import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction, type Plugin } from '@opensales/plugin-sdk';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../jobs/job-queue.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { StockService } from '../stock/stock.service.js';

import {
  collectSkuCandidates,
  type EmagOrderRaw,
  mapEmagOrderToDb,
  preserveSubstitutions,
} from './emag-order-sync.mapper.js';

const EMAG_PACKAGE = '@opensales-plugin/emag';
const SYNC_JOB = 'emag-order-sync';
const BACKFILL_JOB = 'emag-order-backfill';

const ACTIVE_STATUSES = new Set<string>(['new', 'processing', 'packed', 'shipped', 'undelivered']);
const TERMINAL_STATUSES = new Set<string>(['cancelled', 'returned', 'refunded']);
const SYNC_CRON = '0 * * * *';
// Comenzile nu se mai modifică practic după 6 luni — sincronizarea orară nu
// trebuie să re-parcurgă tot istoricul, doar fereastra activă.
const HOURLY_WINDOW_DAYS = 30;
// Plasă de siguranță: la fiecare 2 zile, re-verificăm tot istoricul de 6 luni
// (în felii de 30 zile — eMAG limitează createdAfter/createdBefore la 1 lună).
// ponytail: „*/2" pe zi-din-lună e aproximativ (resetează la început de lună),
// nu un interval exact de 48h — suficient pentru o plasă de siguranță.
const BACKFILL_CRON = '0 0 */2 * *';
const BACKFILL_WINDOW_DAYS = 180;
const PAGE_SIZE = 100;

interface SyncJobData {
  pluginId: string;
  createdAfter?: string;
  createdBefore?: string;
}

interface BackfillJobData {
  pluginId: string;
}

interface CreatedWindow {
  createdAfter: string;
  createdBefore: string;
}

interface SyncOrdersOutput {
  items: EmagOrderRaw[];
  currentPage: number;
  itemsPerPage: number;
  totalCount?: number;
}

const CURRENCY_MAP: Record<string, string> = {
  'emag-ro': 'RON',
  'emag-bg': 'BGN',
  'emag-hu': 'HUF',
  'fd-ro': 'RON',
  'fd-bg': 'BGN',
};

@Injectable()
export class EmagOrderSyncService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly queue: JobQueueService,
    private readonly stock: StockService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<SyncJobData>(SYNC_JOB, (data) =>
      this.runSync(data.pluginId, data.createdAfter, data.createdBefore),
    );
    await this.queue.register<BackfillJobData>(BACKFILL_JOB, (data) =>
      this.runBackfill(data.pluginId),
    );

    const plugin = await this.registry.findByPackageName(EMAG_PACKAGE);
    if (!plugin) return;

    // Schedule recurring hourly sync + 2-day backfill. Both gracefully skip
    // when plugin is not active or not loaded — safe to schedule unconditionally,
    // covering the case where the plugin is activated after bootstrap.
    await this.scheduleHourlySync(plugin.id);
    await this.scheduleBackfill(plugin.id);

    // Kick off an immediate sync on startup so we don't wait a full hour
    // after each redeploy. Short startAfter delay gives PluginBootScanner
    // time to finish loading plugins (its onApplicationBootstrap hook may
    // run after this one — NestJS doesn't guarantee ordering).
    await this.queue.enqueue<SyncJobData>(SYNC_JOB, { pluginId: plugin.id }, { startAfter: 15 });
    this.logger.log({ pluginId: plugin.id }, 'eMAG order sync triggered on startup');
  }

  async scheduleHourlySync(pluginId: string): Promise<void> {
    await this.queue.raw().schedule(SYNC_JOB, SYNC_CRON, { pluginId } satisfies SyncJobData, {
      tz: 'UTC',
    });
    this.logger.log({ pluginId }, 'eMAG order sync scheduled (hourly)');
  }

  async scheduleBackfill(pluginId: string): Promise<void> {
    await this.queue
      .raw()
      .schedule(BACKFILL_JOB, BACKFILL_CRON, { pluginId } satisfies BackfillJobData, { tz: 'UTC' });
    this.logger.log({ pluginId }, 'eMAG order backfill scheduled (every 2 days)');
  }

  /**
   * Enqueue an immediate sync job. Returns the eMAG pluginId, or null if the
   * plugin is not installed. The job runs asynchronously via pg-boss — caller
   * receives a fast response while sync runs in the background.
   */
  async triggerImmediateSync(options?: {
    sinceDays?: number;
  }): Promise<{ pluginId: string; createdAfter?: string } | null> {
    const plugin = await this.registry.findByPackageName(EMAG_PACKAGE);
    if (!plugin) return null;
    const window =
      options?.sinceDays !== undefined ? this.createdWindow(options.sinceDays) : undefined;
    const data: SyncJobData = { pluginId: plugin.id };
    if (window) {
      data.createdAfter = window.createdAfter;
      data.createdBefore = window.createdBefore;
    }
    await this.queue.enqueue<SyncJobData>(SYNC_JOB, data);
    this.logger.log({ pluginId: plugin.id, window }, 'eMAG order sync triggered manually');
    return window
      ? { pluginId: plugin.id, createdAfter: window.createdAfter }
      : { pluginId: plugin.id };
  }

  async syncSingleOrder(pluginId: string, emagOrderId: number): Promise<void> {
    const loaded = this.loaded.getById(pluginId);
    if (!loaded) {
      this.logger.warn({ pluginId, emagOrderId }, 'eMAG plugin not loaded — skipping webhook');
      return;
    }

    const result = (await invokeAction(loaded.instance, 'syncOrders', {
      id: [emagOrderId],
      itemsPerPage: 1,
      currentPage: 1,
    })) as SyncOrdersOutput;

    const order = result.items[0];
    if (!order) {
      this.logger.warn({ pluginId, emagOrderId }, 'eMAG order not found');
      return;
    }

    const plugin = await this.registry.findById(pluginId);
    const marketplace = this.resolvePlatforms(plugin?.config)[0] ?? 'emag-ro';
    const currency = CURRENCY_MAP[marketplace] ?? 'RON';
    const isNew = await this.upsertOrder(order, pluginId, currency, marketplace);

    if (order.status === 1 && isNew) {
      const acknowledged = await this.acknowledgeOrder(loaded.instance, pluginId, order.id);
      if (acknowledged) this.logger.log({ pluginId, emagOrderId }, 'eMAG order acknowledged');
    }
  }

  /** Sync orar — implicit ultimele {@link HOURLY_WINDOW_DAYS} zile (comenzile mai vechi nu se mai modifică). */
  async runSync(pluginId: string, createdAfter?: string, createdBefore?: string): Promise<void> {
    const plugin = await this.registry.findById(pluginId);
    if (plugin?.status !== 'active') return;

    const loaded = this.loaded.getById(pluginId);
    if (!loaded) {
      this.logger.warn({ pluginId }, 'eMAG plugin not loaded — skipping sync');
      return;
    }

    const window =
      createdAfter !== undefined && createdBefore !== undefined
        ? { createdAfter, createdBefore }
        : this.createdWindow(HOURLY_WINDOW_DAYS);
    const platforms = this.resolvePlatforms(plugin.config);

    this.logger.log({ pluginId, window, platforms }, 'eMAG order sync started');
    const totals = await this.syncPlatforms(loaded.instance, pluginId, platforms, window);
    this.logger.log({ pluginId, ...totals }, 'eMAG order sync completed');
  }

  /**
   * Plasă de siguranță la fiecare 2 zile: comenzile mai vechi de
   * {@link HOURLY_WINDOW_DAYS} zile ies din fereastra sync-ului orar, dar tot
   * pot primi update-uri până la {@link BACKFILL_WINDOW_DAYS} zile. eMAG
   * limitează createdAfter/createdBefore la maximum 1 lună — parcurgem
   * intervalul in felii de {@link HOURLY_WINDOW_DAYS} zile.
   */
  async runBackfill(pluginId: string): Promise<void> {
    const plugin = await this.registry.findById(pluginId);
    if (plugin?.status !== 'active') return;

    const loaded = this.loaded.getById(pluginId);
    if (!loaded) {
      this.logger.warn({ pluginId }, 'eMAG plugin not loaded — skipping backfill');
      return;
    }

    const platforms = this.resolvePlatforms(plugin.config);
    const windows = this.slicedWindows(BACKFILL_WINDOW_DAYS, HOURLY_WINDOW_DAYS);

    this.logger.log({ pluginId, platforms, slices: windows.length }, 'eMAG order backfill started');
    let synced = 0;
    let acknowledged = 0;
    for (const window of windows) {
      const totals = await this.syncPlatforms(loaded.instance, pluginId, platforms, window);
      synced += totals.synced;
      acknowledged += totals.acknowledged;
    }
    this.logger.log({ pluginId, synced, acknowledged }, 'eMAG order backfill completed');
  }

  private resolvePlatforms(config: unknown): string[] {
    const enabledMarketplaces =
      (config as { enabledMarketplaces?: string[] } | null)?.enabledMarketplaces ?? [];
    const emagPlatforms = enabledMarketplaces.filter(
      (m) => m.startsWith('emag-') || m.startsWith('fd-'),
    );
    return emagPlatforms.length > 0 ? emagPlatforms : ['emag-ro'];
  }

  private async syncPlatforms(
    instance: Plugin,
    pluginId: string,
    platforms: string[],
    window: CreatedWindow,
  ): Promise<{ synced: number; acknowledged: number }> {
    let synced = 0;
    let acknowledged = 0;

    for (const platform of platforms) {
      const currency = CURRENCY_MAP[platform] ?? 'RON';
      let page = 1;

      do {
        const result = await this.fetchOrderPage(instance, platform, page, window);
        const pageTotals = await this.processOrderPage(
          instance,
          pluginId,
          platform,
          currency,
          result.items,
        );
        synced += pageTotals.synced;
        acknowledged += pageTotals.acknowledged;

        if (result.items.length < PAGE_SIZE) break;
        page++;
      } while (page > 0);
    }

    return { synced, acknowledged };
  }

  private async fetchOrderPage(
    instance: Plugin,
    platform: string,
    page: number,
    window: CreatedWindow,
  ): Promise<SyncOrdersOutput> {
    const syncInput: Record<string, unknown> = {
      itemsPerPage: PAGE_SIZE,
      currentPage: page,
      platform,
      createdAfter: window.createdAfter,
      createdBefore: window.createdBefore,
    };
    return (await invokeAction(instance, 'syncOrders', syncInput)) as SyncOrdersOutput;
  }

  private async processOrderPage(
    instance: Plugin,
    pluginId: string,
    platform: string,
    currency: string,
    orders: EmagOrderRaw[],
  ): Promise<{ synced: number; acknowledged: number }> {
    let synced = 0;
    let acknowledged = 0;

    for (const order of orders) {
      try {
        const isNew = await this.upsertOrder(order, pluginId, currency, platform);
        synced++;

        if (order.status === 1 && isNew) {
          const wasAcknowledged = await this.acknowledgeOrder(
            instance,
            pluginId,
            order.id,
            platform,
          );
          if (wasAcknowledged) acknowledged++;
        }
      } catch (err) {
        this.logger.error(
          { pluginId, orderId: order.id, platform, err },
          'failed to upsert eMAG order',
        );
      }
    }

    return { synced, acknowledged };
  }

  /** Confirmă comanda pe eMAG + trece statusul local pe processing. Nu aruncă — un eșec de acknowledge nu trebuie să oprească sync-ul. */
  private async acknowledgeOrder(
    instance: Plugin,
    pluginId: string,
    orderId: number,
    platform?: string,
  ): Promise<boolean> {
    try {
      const input: Record<string, unknown> = { orderId };
      if (platform !== undefined) input.platform = platform;
      await invokeAction(instance, 'acknowledgeOrder', input);
      await this.setOrderProcessing(pluginId, orderId);
      return true;
    } catch (err) {
      this.logger.warn({ pluginId, orderId, platform, err }, 'acknowledge failed');
      return false;
    }
  }

  /** Fereastră createdAfter/createdBefore (format eMAG) acoperind ultimele `daysBack` zile. */
  private createdWindow(daysBack: number, now = new Date()): CreatedWindow {
    const after = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return { createdAfter: this.toEmagDateTime(after), createdBefore: this.toEmagDateTime(now) };
  }

  /** Felii de `sliceDays` zile care acoperă ultimele `totalDays` zile (eMAG: max 1 lună/request). */
  private slicedWindows(totalDays: number, sliceDays: number): CreatedWindow[] {
    const now = new Date();
    const windows: CreatedWindow[] = [];
    for (let start = totalDays; start > 0; start -= sliceDays) {
      const end = Math.max(start - sliceDays, 0);
      windows.push({
        createdAfter: this.toEmagDateTime(new Date(now.getTime() - start * 24 * 60 * 60 * 1000)),
        createdBefore: this.toEmagDateTime(new Date(now.getTime() - end * 24 * 60 * 60 * 1000)),
      });
    }
    return windows;
  }

  /**
   * `YYYY-MM-DD HH:ii:ss` (Europe/Bucharest, ora locală) — formatul cerut de eMAG
   * pentru createdAfter/createdBefore. eMAG interpretează aceste string-uri ca oră
   * locală România (EET/EEST), nu UTC — folosim Intl pentru conversie corectă cu DST.
   */
  private toEmagDateTime(d: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
  }

  private async upsertOrder(
    raw: EmagOrderRaw,
    pluginId: string,
    currency: string,
    marketplace: string,
  ): Promise<boolean> {
    const productIdBySku = await this.resolveProductIds(collectSkuCandidates(raw));
    const { order: mapped, items } = mapEmagOrderToDb(
      raw,
      pluginId,
      currency,
      productIdBySku,
      marketplace,
    );
    const externalId = String(raw.id);

    const stockItems = items
      .filter((i): i is typeof i & { productId: string } => i.productId !== null && i.quantity > 0)
      .map(({ productId, quantity }) => ({ productId, quantity }));
    let reservationAction: 'reserve' | 'release' | null = null;

    const isNew = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({
          id: schema.orders.id,
          invoice: schema.orders.invoice,
          awbOutgoing: schema.orders.awbOutgoing,
          placedAt: schema.orders.placedAt,
          totalAmountMinor: schema.orders.totalAmountMinor,
          customerName: schema.orders.customerName,
          customerEmail: schema.orders.customerEmail,
          customerPhone: schema.orders.customerPhone,
          billingAddress: schema.orders.billingAddress,
          shippingAddress: schema.orders.shippingAddress,
          status: schema.orders.status,
          stockReservationClaimed: schema.orders.stockReservationClaimed,
        })
        .from(schema.orders)
        .where(and(eq(schema.orders.pluginId, pluginId), eq(schema.orders.externalId, externalId)))
        .limit(1);

      if (existing.length === 0) {
        const shouldReserve = ACTIVE_STATUSES.has(mapped.status ?? 'new') && stockItems.length > 0;
        if (shouldReserve) reservationAction = 'reserve';
        await tx
          .insert(schema.orders)
          .values({ ...mapped, rawPayload: raw, stockReservationClaimed: shouldReserve });
        if (items.length > 0) {
          await tx.insert(schema.orderItems).values(items);
        }
        return true;
      }

      const ex = existing[0] ?? null;
      if (!ex?.id) return false;
      const orderId = ex.id;

      const wasClaimed = ex.stockReservationClaimed;
      const nowTerminal = TERMINAL_STATUSES.has(mapped.status ?? 'new');
      if (wasClaimed && nowTerminal && stockItems.length > 0) reservationAction = 'release';

      // Preserve already-stored invoice/AWB unless eMAG now returns one and
      // we don't have it yet. Never overwrite a locally-issued invoice/AWB
      // (e.g. via FGO/Sameday plugins) with the eMAG-side attachment.
      const invoiceToWrite = ex.invoice ?? mapped.invoice ?? null;
      const awbToWrite = ex.awbOutgoing ?? mapped.awbOutgoing ?? null;

      // FBE (type=2) payloads arrive with customer=null and products=[].
      // Preserve existing customer/address/total rather than wiping real data.
      const hasCustomer = raw.customer !== null && raw.customer !== undefined;
      const hasProducts = (raw.products?.length ?? 0) > 0;

      await tx
        .update(schema.orders)
        .set({
          status: mapped.status ?? 'new',
          stockReservationClaimed: reservationAction === 'release' ? false : wasClaimed,
          // Preserve real total when FBE sends an empty products list.
          totalAmountMinor: hasProducts ? mapped.totalAmountMinor : ex.totalAmountMinor,
          // Correct a wrong placedAt (e.g. from an earlier FBE INSERT) when
          // real date arrives; keep existing when incoming payload has no date.
          placedAt: raw.date ? mapped.placedAt : ex.placedAt,
          customerName: hasCustomer ? (mapped.customerName ?? null) : (ex.customerName ?? null),
          customerEmail: hasCustomer ? (mapped.customerEmail ?? null) : (ex.customerEmail ?? null),
          customerPhone: hasCustomer ? (mapped.customerPhone ?? null) : (ex.customerPhone ?? null),
          billingAddress: hasCustomer ? (mapped.billingAddress ?? {}) : (ex.billingAddress ?? {}),
          shippingAddress: hasCustomer
            ? (mapped.shippingAddress ?? {})
            : (ex.shippingAddress ?? {}),
          invoice: invoiceToWrite,
          awbOutgoing: awbToWrite,
          shippingCostMinor: mapped.shippingCostMinor ?? null,
          taxMinor: mapped.taxMinor ?? null,
          vouchersMinor: mapped.vouchersMinor ?? null,
          paymentStatus: mapped.paymentStatus ?? null,
          refundedAmountMinor: mapped.refundedAmountMinor ?? null,
          deliveryLocation: mapped.deliveryLocation ?? null,
          finalizedAt: mapped.finalizedAt ?? null,
          attachments: mapped.attachments ?? null,
          rawPayload: raw,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      if (items.length > 0) {
        // Substituțiile manuale (vezi OrdersService.substituteItem) trăiesc doar
        // în order_items — trebuie reaplicate peste payload-ul eMAG, altfel
        // delete+insert de mai jos le suprascrie silențios la fiecare re-sync.
        const existingSubstituted = await tx
          .select({
            productId: schema.orderItems.productId,
            sku: schema.orderItems.sku,
            name: schema.orderItems.name,
            originalSku: schema.orderItems.originalSku,
            originalName: schema.orderItems.originalName,
            originalProductId: schema.orderItems.originalProductId,
            substitutedAt: schema.orderItems.substitutedAt,
            quantity: schema.orderItems.quantity,
          })
          .from(schema.orderItems)
          .where(
            and(eq(schema.orderItems.orderId, orderId), isNotNull(schema.orderItems.substitutedAt)),
          );

        const mergedItems = preserveSubstitutions(existingSubstituted, items);
        await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
        const updatedItems = mergedItems.map((item) => ({ ...item, orderId }));
        await tx.insert(schema.orderItems).values(updatedItems);
      }

      return false;
    });

    if (reservationAction === 'reserve') await this.stock.reserve(stockItems);
    else if (reservationAction === 'release') await this.stock.releaseReservation(stockItems);

    return isNew;
  }

  private async setOrderProcessing(pluginId: string, emagOrderId: number): Promise<void> {
    await this.db
      .update(schema.orders)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(
        and(
          eq(schema.orders.pluginId, pluginId),
          eq(schema.orders.externalId, String(emagOrderId)),
        ),
      );
  }

  /**
   * Single DB roundtrip — given a list of SKU candidates (eMAG `part_number`
   * and `part_number_key` values), returns a Map sku→productId so the mapper
   * can link order items to local products without a per-item query.
   */
  private async resolveProductIds(
    skus: string[],
  ): Promise<Map<string, { id: string; sku: string }>> {
    const out = new Map<string, { id: string; sku: string }>();
    const unique = Array.from(new Set(skus.filter((s) => s && s.length > 0)));
    if (unique.length === 0) return out;
    const rows = await this.db
      .select({ id: schema.products.id, sku: schema.products.sku })
      .from(schema.products)
      .where(inArray(schema.products.sku, unique));
    for (const row of rows) out.set(row.sku, { id: row.id, sku: row.sku });
    return out;
  }
}
