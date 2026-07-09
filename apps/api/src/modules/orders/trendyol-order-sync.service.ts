import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction, type Plugin } from '@opensales/plugin-sdk';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../jobs/job-queue.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { StockService } from '../stock/stock.service.js';

import {
  collectLineCandidates,
  mapTrendyolPackageToDb,
  type ResolvedProduct,
  type TrendyolPackageRaw,
} from './trendyol-order-sync.mapper.js';

const TRENDYOL_PACKAGE = '@opensales-plugin/trendyol';
const SYNC_JOB = 'trendyol-order-sync';
const SYNC_CRON = '0 * * * *';

const ACTIVE_STATUSES = new Set<string>(['new', 'processing', 'packed', 'shipped', 'undelivered']);
const TERMINAL_STATUSES = new Set<string>(['cancelled', 'returned', 'refunded']);

/** Default total lookback when no startDate is provided (14 days). */
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * Max per-request window size (3 days).
 * Trendyol stream returns the same cursor after ~100 orders for windows > ~10 days
 * (orders with null packageLastModifiedDate, e.g. Picking status, are excluded in
 * large windows). 3-day windows stay under ~50 orders → single page → no cursor repeat.
 */
const MAX_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface SyncWindow {
  start: number;
  end: number;
}

/**
 * Splits [effectiveStart, now] into consecutive windows of at most maxWindowMs,
 * returned newest → oldest so the DB receives freshest data first.
 */
export function buildSyncWindows(opts: {
  startDate?: number;
  now: number;
  lookbackMs?: number;
  maxWindowMs?: number;
}): SyncWindow[] {
  const lookback = opts.lookbackMs ?? LOOKBACK_MS;
  const maxWindow = opts.maxWindowMs ?? MAX_WINDOW_MS;
  const effectiveStart = opts.startDate ?? opts.now - lookback;
  const windows: SyncWindow[] = [];
  let winEnd = opts.now;
  while (winEnd > effectiveStart) {
    const winStart = Math.max(effectiveStart, winEnd - maxWindow);
    windows.push({ start: winStart, end: winEnd });
    winEnd = winStart - 1;
  }
  return windows;
}

interface SyncJobData {
  pluginId: string;
  startDate?: number;
}

interface GetOrdersStreamOutput {
  hasMore: boolean;
  nextCursor?: string | null;
  size: number;
  content: TrendyolPackageRaw[];
}

/** Country code suffix → ISO 4217 currency */
const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  RO: 'RON',
  BG: 'EUR',
  GR: 'EUR',
  SK: 'EUR',
  CZ: 'CZK',
  DE: 'EUR',
  SA: 'SAR',
  AE: 'AED',
  KW: 'KWD',
};

@Injectable()
export class TrendyolOrderSyncService implements OnApplicationBootstrap {
  // ponytail: guard simplu în memorie — un singur replica (numReplicas=1 în railway.toml),
  // deci nu e nevoie de lock distribuit. Dacă trecem la mai multe replici, mută în DB.
  private running = false;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly queue: JobQueueService,
    private readonly logger: Logger,
    private readonly stock: StockService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<SyncJobData>(SYNC_JOB, (data) =>
      this.runSync(data.pluginId, data.startDate),
    );

    const plugin = await this.registry.findByPackageName(TRENDYOL_PACKAGE);
    if (!plugin) return;

    await this.scheduleHourlySync(plugin.id);

    await this.queue.enqueue<SyncJobData>(SYNC_JOB, { pluginId: plugin.id }, { startAfter: 15 });
    this.logger.log({ pluginId: plugin.id }, 'Trendyol order sync triggered on startup');
  }

  async scheduleHourlySync(pluginId: string): Promise<void> {
    await this.queue.raw().schedule(SYNC_JOB, SYNC_CRON, { pluginId } satisfies SyncJobData, {
      tz: 'UTC',
    });
    this.logger.log({ pluginId }, 'Trendyol order sync scheduled (hourly)');
  }

  /**
   * Enqueue an immediate sync job. Returns the Trendyol pluginId, or null if
   * the plugin is not installed. The job runs asynchronously via pg-boss —
   * caller receives a fast response while sync runs in the background.
   */
  async triggerImmediateSync(options?: {
    sinceHours?: number;
  }): Promise<{ pluginId: string } | null> {
    const plugin = await this.registry.findByPackageName(TRENDYOL_PACKAGE);
    if (!plugin) return null;
    const startDate =
      options?.sinceHours !== undefined
        ? Date.now() - options.sinceHours * 60 * 60 * 1000
        : undefined;
    const data: SyncJobData = { pluginId: plugin.id };
    if (startDate !== undefined) data.startDate = startDate;
    await this.queue.enqueue<SyncJobData>(SYNC_JOB, data);
    this.logger.log({ pluginId: plugin.id, startDate }, 'Trendyol order sync triggered manually');
    return { pluginId: plugin.id };
  }

  async runSync(pluginId: string, startDate?: number): Promise<void> {
    if (this.running) {
      this.logger.warn(
        { pluginId },
        'Trendyol order sync: rulare anterioară încă activă, sar peste acest ciclu',
      );
      return;
    }
    this.running = true;
    try {
      const plugin = await this.registry.findById(pluginId);
      if (plugin?.status !== 'active') return;

      const loaded = this.loaded.getById(pluginId);
      if (!loaded) {
        this.logger.warn({ pluginId }, 'Trendyol plugin not loaded — skipping sync');
        return;
      }

      const markets = this.resolveMarkets(plugin.config);
      const now = Date.now();
      const windows = buildSyncWindows({ ...(startDate !== undefined && { startDate }), now });

      this.logger.log(
        { pluginId, startDate: startDate ?? null, windows: windows.length, markets },
        'Trendyol order stream sync started',
      );

      const synced = await this.syncMarkets(loaded.instance, pluginId, markets, windows);
      this.logger.log({ pluginId, synced }, 'Trendyol order sync completed');
    } finally {
      this.running = false;
    }
  }

  private resolveMarkets(config: unknown): string[] {
    const enabledMarketplaces =
      (config as { enabledMarketplaces?: string[] } | null)?.enabledMarketplaces ?? [];
    const trendyolMarkets = enabledMarketplaces.filter((m) => m.startsWith('trendyol-'));
    return trendyolMarkets.length > 0 ? trendyolMarkets : ['trendyol-ro'];
  }

  private async syncMarkets(
    instance: Plugin,
    pluginId: string,
    markets: string[],
    windows: SyncWindow[],
  ): Promise<number> {
    let synced = 0;
    for (const marketCode of markets) {
      const storeFrontCode = marketCode.replace('trendyol-', '').toUpperCase();
      const currency = COUNTRY_CURRENCY_MAP[storeFrontCode] ?? 'EUR';

      for (const win of windows) {
        synced += await this.syncWindow(
          instance,
          pluginId,
          marketCode,
          storeFrontCode,
          currency,
          win,
        );
      }
    }
    return synced;
  }

  /**
   * Parcurge cursor-ul unei ferestre până se termină. Când cursor-ul e setat,
   * Trendyol codifică poziția în el — retrimiterea parametrilor de dată
   * resetează stream-ul și cauzează o buclă infinită, deci nu-i mai trimitem.
   */
  private async syncWindow(
    instance: Plugin,
    pluginId: string,
    marketCode: string,
    storeFrontCode: string,
    currency: string,
    win: SyncWindow,
  ): Promise<number> {
    let synced = 0;
    let cursor: string | undefined;
    let prevCursor: string | undefined;

    do {
      const result = await this.fetchOrderStreamPage(instance, storeFrontCode, cursor, win);
      const content: TrendyolPackageRaw[] = Array.isArray(result.content) ? result.content : [];

      this.logger.log(
        {
          pluginId,
          marketCode,
          winStart: win.start,
          winEnd: win.end,
          cursor: cursor ?? null,
          returned: content.length,
          hasMore: result.hasMore,
        },
        'Trendyol order stream: window fetched',
      );

      synced += await this.upsertPackages(pluginId, marketCode, currency, content);

      prevCursor = cursor;
      cursor = result.hasMore && result.nextCursor ? result.nextCursor : undefined;

      // Safety: if API returns the same cursor twice, stop to avoid infinite loop.
      if (cursor !== undefined && cursor === prevCursor) {
        this.logger.warn(
          { pluginId, marketCode, cursor },
          'Trendyol stream returned identical cursor — breaking to avoid infinite loop',
        );
        break;
      }
    } while (cursor !== undefined);

    return synced;
  }

  private async fetchOrderStreamPage(
    instance: Plugin,
    storeFrontCode: string,
    cursor: string | undefined,
    win: SyncWindow,
  ): Promise<GetOrdersStreamOutput> {
    const streamInput: Record<string, unknown> = { storeFrontCode };
    if (cursor !== undefined) {
      streamInput.cursor = cursor;
    } else {
      streamInput.lastModifiedStartDate = win.start;
      streamInput.lastModifiedEndDate = win.end;
    }
    return (await invokeAction(instance, 'getOrdersStream', streamInput)) as GetOrdersStreamOutput;
  }

  private async upsertPackages(
    pluginId: string,
    marketCode: string,
    currency: string,
    packages: TrendyolPackageRaw[],
  ): Promise<number> {
    let synced = 0;
    for (const pkg of packages) {
      try {
        await this.upsertOrder(pkg, pluginId, currency, marketCode);
        synced++;
      } catch (err) {
        this.logger.error(
          { pluginId, marketCode, shipmentPackageId: pkg.shipmentPackageId, err },
          'failed to upsert Trendyol order',
        );
      }
    }
    return synced;
  }

  private async upsertOrder(
    raw: TrendyolPackageRaw,
    pluginId: string,
    currency: string,
    marketplace: string,
  ): Promise<void> {
    const resolvedProducts = await this.resolveLines(collectLineCandidates(raw), pluginId);
    const { order: mapped, items } = mapTrendyolPackageToDb(
      raw,
      pluginId,
      currency,
      resolvedProducts,
      marketplace,
    );
    const externalId = mapped.externalId;
    const newStatus = mapped.status ?? 'new';
    const stockItems = items
      .filter((i): i is typeof i & { productId: string } => i.productId !== null)
      .map(({ productId, quantity }) => ({ productId, quantity }));

    let reservationAction: 'reserve' | 'release' | null = null;

    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: schema.orders.id,
          invoice: schema.orders.invoice,
          awbOutgoing: schema.orders.awbOutgoing,
          stockReservationClaimed: schema.orders.stockReservationClaimed,
        })
        .from(schema.orders)
        .where(and(eq(schema.orders.pluginId, pluginId), eq(schema.orders.externalId, externalId)))
        .limit(1);

      if (!existing) {
        const shouldClaim = ACTIVE_STATUSES.has(newStatus) && stockItems.length > 0;
        await tx
          .insert(schema.orders)
          .values({ ...mapped, rawPayload: raw, stockReservationClaimed: shouldClaim });
        if (items.length > 0) await tx.insert(schema.orderItems).values(items);
        if (shouldClaim) reservationAction = 'reserve';
        return;
      }

      const orderId = existing.id;
      const wasClaimed = existing.stockReservationClaimed;
      const goesTerminal = TERMINAL_STATUSES.has(newStatus);
      const newClaimed = goesTerminal ? false : wasClaimed;

      // Preserve already-stored invoice/AWB unless we don't have it yet.
      const invoiceToWrite = existing.invoice ?? mapped.invoice ?? null;
      const awbToWrite = existing.awbOutgoing ?? mapped.awbOutgoing ?? null;

      await tx
        .update(schema.orders)
        .set({
          status: newStatus,
          totalAmountMinor: mapped.totalAmountMinor,
          customerName: mapped.customerName ?? null,
          customerEmail: mapped.customerEmail ?? null,
          billingAddress: mapped.billingAddress ?? {},
          shippingAddress: mapped.shippingAddress ?? {},
          invoice: invoiceToWrite,
          awbOutgoing: awbToWrite,
          stockReservationClaimed: newClaimed,
          rawPayload: raw,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      if (items.length > 0) {
        await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
        const updatedItems = items.map((item) => ({ ...item, orderId }));
        await tx.insert(schema.orderItems).values(updatedItems);
      }

      if (wasClaimed && goesTerminal && stockItems.length > 0) reservationAction = 'release';
    });

    if (reservationAction === 'reserve') await this.stock.reserve(stockItems);
    else if (reservationAction === 'release') await this.stock.releaseReservation(stockItems);
  }

  /**
   * 4-step product resolution for a batch of order lines.
   * Returns a Map keyed by line.merchantSku → resolved product.
   *
   * Step 1: products.sku = line.merchantSku (any product, exact match).
   * Step 2: products.ean = line.barcode    (Trendyol-listed products only).
   * Step 3: products.ean = line.sku        (Trendyol-listed products only).
   * Step 4: line.productName contains one of our Trendyol-listed product SKUs (substring).
   * Fallback (unresolved): { productId: null, sku: line.barcode || line.merchantSku }.
   */
  private async resolveLines(
    lines: {
      lineId: string;
      merchantSku: string;
      barcode: string;
      lineSku: string;
      productName: string;
    }[],
    pluginId: string,
  ): Promise<Map<string, ResolvedProduct>> {
    const result = new Map<string, ResolvedProduct>();
    if (lines.length === 0) return result;

    // Condiția de join produs↔listing pentru acest plugin — identică la pașii 0, 2/3, 4.
    const listingJoin = and(
      eq(schema.listings.productId, schema.products.id),
      eq(schema.listings.pluginId, pluginId),
    );

    // ── Step 0: Manual match — barcode mapped via matchItem endpoint ─────────
    // Verifică dacă există listing cu externalListingId = 'manual:' + barcode
    // sau cu barcode în syncState.manual_match_barcodes.
    const allBarcodes = [...new Set(lines.map((l) => l.barcode).filter((s) => s.length > 0))];
    if (allBarcodes.length > 0) {
      const manualExternal = allBarcodes.map((b) => `manual:${b}`);
      const rows0 = await this.db
        .select({
          id: schema.products.id,
          sku: schema.products.sku,
          name: schema.products.name,
          externalListingId: schema.listings.externalListingId,
          syncState: schema.listings.syncState,
        })
        .from(schema.products)
        .innerJoin(schema.listings, listingJoin)
        .where(
          or(
            inArray(schema.listings.externalListingId, manualExternal),
            sql`EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(${schema.listings.syncState}->'manual_match_barcodes') AS bc(v)
              WHERE bc.v IN (${sql.join(
                allBarcodes.map((b) => sql`${b}`),
                sql`, `,
              )})
            )`,
          ),
        );
      for (const row of rows0) {
        const manualBarcodes = Array.isArray(row.syncState?.manual_match_barcodes)
          ? (row.syncState.manual_match_barcodes as string[])
          : [];
        // Barcode via externalListingId ('manual:barcode')
        const extBarcode = row.externalListingId.startsWith('manual:')
          ? row.externalListingId.slice(7)
          : null;
        for (const line of lines) {
          if (result.has(line.lineId)) continue;
          if (
            (extBarcode !== null && line.barcode === extBarcode) ||
            manualBarcodes.includes(line.barcode)
          ) {
            result.set(line.lineId, { productId: row.id, sku: row.sku, name: row.name });
          }
        }
      }
    }

    // ── Step 1: exact SKU match ──────────────────────────────────────────────
    // Map is keyed by lineId so lines with the same merchantSku resolve independently.
    const merchantSkus = [...new Set(lines.map((l) => l.merchantSku).filter((s) => s.length > 0))];
    if (merchantSkus.length > 0) {
      const rows = await this.db
        .select({ id: schema.products.id, sku: schema.products.sku, name: schema.products.name })
        .from(schema.products)
        .where(inArray(schema.products.sku, merchantSkus));
      for (const row of rows) {
        for (const line of lines) {
          if (line.merchantSku === row.sku && !result.has(line.lineId)) {
            result.set(line.lineId, { productId: row.id, sku: row.sku, name: row.name });
          }
        }
      }
    }

    // ── Steps 2 & 3: EAN match against Trendyol-listed products ─────────────
    const unresolved = lines.filter((l) => !result.has(l.lineId));
    if (unresolved.length > 0) {
      const eanCandidates = [
        ...new Set(
          [...unresolved.map((l) => l.barcode), ...unresolved.map((l) => l.lineSku)].filter(
            (s) => s.length > 0,
          ),
        ),
      ];
      if (eanCandidates.length > 0) {
        const rows = await this.db
          .select({
            id: schema.products.id,
            sku: schema.products.sku,
            name: schema.products.name,
            ean: schema.products.ean,
          })
          .from(schema.products)
          .innerJoin(schema.listings, listingJoin)
          .where(inArray(schema.products.ean, eanCandidates));
        for (const row of rows) {
          if (!row.ean) continue;
          for (const line of unresolved) {
            if (result.has(line.lineId)) continue;
            if (line.barcode === row.ean || line.lineSku === row.ean) {
              result.set(line.lineId, { productId: row.id, sku: row.sku, name: row.name });
            }
          }
        }
      }
    }

    // ── Step 4: productName substring match ──────────────────────────────────
    const stillUnresolved = lines.filter((l) => !result.has(l.lineId) && l.productName);
    if (stillUnresolved.length > 0) {
      const trendyolProducts = await this.db
        .select({ id: schema.products.id, sku: schema.products.sku, name: schema.products.name })
        .from(schema.products)
        .innerJoin(schema.listings, listingJoin);
      for (const line of stillUnresolved) {
        if (result.has(line.lineId)) continue;
        const nameLower = line.productName.toLowerCase();
        for (const product of trendyolProducts) {
          if (product.sku && nameLower.includes(product.sku.toLowerCase())) {
            result.set(line.lineId, {
              productId: product.id,
              sku: product.sku,
              name: product.name,
            });
            break;
          }
        }
      }
    }

    return result;
  }
}
