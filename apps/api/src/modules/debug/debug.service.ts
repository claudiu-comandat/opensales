import * as v8 from 'node:v8';

import { Inject, Injectable } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { and, count, eq, like, sql } from 'drizzle-orm';

import type { Database } from '@opensales/db';

import { ConfigService } from '../../config/config.service.js';
import { JobQueueService } from '../../jobs/job-queue.service.js';
import { EmagImportService } from '../import/emag-import.service.js';
import { TemuImportService } from '../import/temu-import.service.js';
import { TrendyolImportService } from '../import/trendyol-import.service.js';
import { fetchInvoiceRef } from '../invoice/fgo-pdf-ref.js';
import { trendyolStorefrontFor } from '../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';

import { aggregateRejectedListings, type RejectedListingsReport } from './rejected-listings.js';

export interface DebugInfo {
  system: {
    nodeEnv: string;
    uptimeSeconds: number;
    nodeVersion: string;
    hasPublicApiUrl: boolean;
    railwayStaticUrl: string | null;
  };
  plugins: {
    id: string;
    packageName: string;
    displayName: string;
    version: string;
    status: string;
    lastError: string | null;
    lastHealthCheckAt: string | null;
    installedAt: string;
    grantedPermissions: string[];
  }[];
  orders: {
    total: number;
    byStatus: Record<string, number>;
    last24hCount: number;
  };
  queue: {
    schedules: { name: string; cron: string; updatedOn: string }[];
    jobsByState: { name: string; state: string; count: number }[];
  };
  memory: {
    process: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
      heapLimitMb: number;
      externalMb: number;
      arrayBuffersMb: number;
    };
    /** Joburi de import active în memorie (Map-uri de progres) — cresc pe durata unui import mare. */
    importJobs: {
      label: string;
      activeJobs: number;
      bufferedErrors: number;
      debugRecords?: number;
    }[];
    pluginRequestLog: { rows: number; totalMb: number };
  };
}

/** Preferă link-ul stabil `/n/p/` (nu expiră) peste `DescarcaFacturaPdf` (token de sesiune). */
function pickStableInvoiceLink(pdfUrl?: string, rawLink?: string): string | undefined {
  const isStable = (u?: string): u is string => typeof u === 'string' && u.includes('/n/p/');
  if (isStable(pdfUrl)) return pdfUrl;
  if (isStable(rawLink)) return rawLink;
  return pdfUrl ?? rawLink;
}

@Injectable()
export class DebugService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly queue: JobQueueService,
    private readonly config: ConfigService,
    private readonly emagImport: EmagImportService,
    private readonly trendyolImport: TrendyolImportService,
    private readonly temuImport: TemuImportService,
  ) {}

  async getDebugInfo(): Promise<DebugInfo> {
    const [plugins, orderStats, queueStats, memoryStats] = await Promise.all([
      this.registry.list(),
      this.getOrderStats(),
      this.getQueueStats(),
      this.getMemoryStats(),
    ]);

    return {
      system: {
        nodeEnv: this.config.nodeEnv,
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        hasPublicApiUrl: !!this.config.publicApiUrl,
        railwayStaticUrl: process.env.RAILWAY_STATIC_URL ?? null,
      },
      plugins: plugins.map((p) => ({
        id: p.id,
        packageName: p.packageName,
        displayName: p.displayName ?? p.packageName,
        version: p.version,
        status: p.status,
        lastError: p.lastError ?? null,
        lastHealthCheckAt: p.lastHealthCheckAt?.toISOString() ?? null,
        installedAt: p.installedAt.toISOString(),
        grantedPermissions: p.grantedPermissions,
      })),
      orders: orderStats,
      queue: queueStats,
      memory: memoryStats,
    };
  }

  /**
   * Consum de memorie: totalul procesului Node + Map-urile de progres ale
   * import-urilor (eMAG/Trendyol/Temu — cresc nemărginit pe durata unui
   * import mare, vezi audit-ul de performanță) + dimensiunea plugin_request_log
   * (unde se acumulează cel mai mult, dacă prune-ul orar rămâne în urmă).
   */
  private async getMemoryStats(): Promise<DebugInfo['memory']> {
    const mem = process.memoryUsage();
    const heapLimitMb = v8.getHeapStatistics().heap_size_limit / 1024 / 1024;
    const toMb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;

    const logSize = await this.db
      .execute<{
        rows: string;
        total_bytes: string;
      }>(
        sql`SELECT count(*)::text AS rows, pg_total_relation_size('plugin_request_log')::text AS total_bytes FROM plugin_request_log`,
      )
      .catch(() => [] as { rows: string; total_bytes: string }[]);
    const logRow = logSize[0];

    return {
      process: {
        rssMb: toMb(mem.rss),
        heapUsedMb: toMb(mem.heapUsed),
        heapTotalMb: toMb(mem.heapTotal),
        heapLimitMb: toMb(heapLimitMb * 1024 * 1024),
        externalMb: toMb(mem.external),
        arrayBuffersMb: toMb(mem.arrayBuffers),
      },
      importJobs: [
        { label: 'eMAG import', ...this.emagImport.getMemoryStats() },
        {
          label: 'Trendyol import',
          ...this.trendyolImport.getMemoryStats(),
        },
        { label: 'Temu import', ...this.temuImport.getMemoryStats() },
      ],
      pluginRequestLog: {
        rows: logRow ? parseInt(logRow.rows, 10) : 0,
        totalMb: logRow ? toMb(parseInt(logRow.total_bytes, 10)) : 0,
      },
    };
  }

  /**
   * Raport agregat al ofertelor cu „Documentație respinsă” (status `rejected`):
   * pe canal (eMAG / Trendyol) → pe mesaj de eroare → câte produse + ce SKU-uri.
   * Acoperă toate marketplace-urile care setează `status = 'rejected'` pe listing.
   */
  async getRejectedListingsReport(): Promise<RejectedListingsReport> {
    const rows = await this.db
      .select({
        listingId: schema.listings.id,
        productId: schema.products.id,
        sku: schema.products.sku,
        platform: schema.listings.platform,
        syncState: schema.listings.syncState,
        lastSyncedAt: schema.listings.lastSyncedAt,
      })
      .from(schema.listings)
      .innerJoin(schema.products, eq(schema.listings.productId, schema.products.id))
      .where(eq(schema.listings.status, 'rejected'));

    return aggregateRejectedListings(
      rows.map((r) => ({
        listingId: r.listingId,
        productId: r.productId,
        sku: r.sku,
        platform: r.platform,
        syncState: r.syncState,
        lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
      })),
    );
  }

  async backfillTrendyolInvoices(): Promise<{
    total: number;
    sent: number;
    skipped: number;
    errors: { orderId: string; message: string }[];
  }> {
    const plugin = this.loaded.getByPackage('@opensales-plugin/trendyol');
    if (!plugin) throw new Error('Plugin Trendyol nu este instalat sau activ');

    const rows = await this.db
      .select({
        id: schema.orders.id,
        marketplace: schema.orders.marketplace,
        invoice: schema.orders.invoice,
        rawPayload: schema.orders.rawPayload,
      })
      .from(schema.orders)
      .where(
        and(
          like(schema.orders.marketplace, 'trendyol-%'),
          sql`${schema.orders.invoice}->>'status' = 'issued'`,
          sql`${schema.orders.invoice}->>'pdf_url' IS NOT NULL`,
          sql`${schema.orders.rawPayload}->>'shipmentPackageId' IS NOT NULL`,
        ),
      );

    let sent = 0;
    let skipped = 0;
    const errors: { orderId: string; message: string }[] = [];

    for (const row of rows) {
      const invoice = row.invoice as Record<string, unknown> | null;
      const rawPayload = row.rawPayload as Record<string, unknown> | null;
      const pdfUrl = invoice?.pdf_url;
      const shipmentPackageId = rawPayload?.shipmentPackageId;

      if (typeof pdfUrl !== 'string' || !pdfUrl || typeof shipmentPackageId !== 'number') continue;

      try {
        await invokeAction(plugin.instance, 'sendInvoiceLink', {
          invoiceLink: pdfUrl,
          shipmentPackageId,
          storeFrontCode: row.marketplace ? trendyolStorefrontFor(row.marketplace) : undefined,
        });
        sent++;
      } catch (err) {
        if ((err as { status?: number }).status === 409) {
          skipped++;
        } else {
          errors.push({
            orderId: row.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return { total: rows.length, sent, skipped, errors };
  }

  /**
   * One-time: comenzile Trendyol migrate au doar link-ul PDF al facturii, nu și
   * seria/numărul (Trendyol nu le trimite — `invoice` are `status:'issued'` dar
   * serie/număr goale). Le extragem din textul PDF-ului FGO și le scriem în
   * `invoice`, necesare pentru stornare. Ignoră comenzile care au deja număr.
   * Acoperă ambele formate de link (`/n/p/` și `DescarcaFacturaPdf`); preferă
   * link-ul stabil `/n/p/` când există (din `pdf_url` sau `rawPayload.invoiceLink`).
   */
  async backfillTrendyolInvoiceRefs(): Promise<{
    total: number;
    filled: number;
    skipped: number;
    errors: { orderId: string; message: string }[];
  }> {
    const rows = await this.db
      .select({
        id: schema.orders.id,
        marketplace: schema.orders.marketplace,
        invoice: schema.orders.invoice,
        rawPayload: schema.orders.rawPayload,
      })
      .from(schema.orders)
      .where(
        and(
          like(schema.orders.marketplace, 'trendyol-%'),
          sql`COALESCE(${schema.orders.invoice}->>'number', '') = ''`,
        ),
      );

    let filled = 0;
    let skipped = 0;
    const errors: { orderId: string; message: string }[] = [];

    for (const row of rows) {
      const invoice = row.invoice;
      const rawLink = (row.rawPayload as Record<string, unknown> | null)?.invoiceLink;
      const url = pickStableInvoiceLink(
        invoice?.pdf_url,
        typeof rawLink === 'string' ? rawLink : undefined,
      );
      if (!invoice || !url) {
        skipped++;
        continue;
      }
      try {
        const { series, number } = await fetchInvoiceRef(url, row.marketplace ?? '');
        await this.db
          .update(schema.orders)
          .set({ invoice: { ...invoice, series, number } })
          .where(eq(schema.orders.id, row.id));
        filled++;
      } catch (err) {
        errors.push({
          orderId: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { total: rows.length, filled, skipped, errors };
  }

  private async getOrderStats(): Promise<DebugInfo['orders']> {
    const [totalRows, byStatusRows, last24hRows] = await Promise.all([
      this.db.select({ count: count() }).from(schema.orders),
      this.db
        .select({ status: schema.orders.status, count: count() })
        .from(schema.orders)
        .groupBy(schema.orders.status),
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(sql`${schema.orders.createdAt} > now() - interval '24 hours'`),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of byStatusRows) {
      byStatus[row.status] = row.count;
    }

    return {
      total: totalRows[0]?.count ?? 0,
      byStatus,
      last24hCount: last24hRows[0]?.count ?? 0,
    };
  }

  private async getQueueStats(): Promise<DebugInfo['queue']> {
    const [scheduleRows, jobRows] = await Promise.all([
      this.db
        .execute<{
          name: string;
          cron: string;
          updated_on: Date;
        }>(
          sql`SELECT name, cron, updated_on FROM pgboss.schedule ORDER BY updated_on DESC LIMIT 50`,
        )
        .catch(() => [] as { name: string; cron: string; updated_on: Date }[]),
      this.db
        .execute<{
          name: string;
          state: string;
          cnt: string;
        }>(
          sql`SELECT name, state, count(*)::text as cnt FROM pgboss.job WHERE created_on > now() - interval '7 days' GROUP BY name, state ORDER BY name, state`,
        )
        .catch(() => [] as { name: string; state: string; cnt: string }[]),
    ]);

    return {
      schedules: scheduleRows.map((r) => ({
        name: r.name,
        cron: r.cron,
        updatedOn: r.updated_on instanceof Date ? r.updated_on.toISOString() : String(r.updated_on),
      })),
      jobsByState: jobRows.map((r) => ({
        name: r.name,
        state: r.state,
        count: parseInt(r.cnt, 10),
      })),
    };
  }
}
