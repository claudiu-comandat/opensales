import { Inject, Injectable } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { Database } from '@opensales/db';

import { DomainError } from '../../errors/domain.error.js';
import { JobQueueService } from '../../jobs/job-queue.service.js';
import {
  PUSH_OFFERS_JOB,
  UPDATE_PRICE_JOB,
  UPDATE_STOCK_JOB,
  type PushOffersJob,
  type UpdatePriceJob,
  type UpdateStockJob,
} from '../import/push-jobs.js';
import { PluginEventsBus } from '../plugins/events/plugin-events.bus.js';

import type { ListListingsDto } from './dto/list-listings.dto.js';
import type { PatchSyncStateDto } from './dto/patch-sync-state.dto.js';
import type { UpsertListingDto } from './dto/upsert-listing.dto.js';

@Injectable()
export class ListingsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly events: PluginEventsBus,
    private readonly queue: JobQueueService,
  ) {}

  async list(input: ListListingsDto): Promise<{ data: schema.Listing[]; total: number }> {
    const filters = [];
    if (input.productId) filters.push(eq(schema.listings.productId, input.productId));
    if (input.pluginId) filters.push(eq(schema.listings.pluginId, input.pluginId));
    if (input.status) filters.push(eq(schema.listings.status, input.status));
    const where = filters.length ? and(...filters) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.listings)
        .where(where)
        .orderBy(desc(schema.listings.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.listings)
        .where(where),
    ]);
    return { data: rows, total: totalRows[0]?.count ?? 0 };
  }

  async listByProduct(productId: string): Promise<schema.Listing[]> {
    return this.db.select().from(schema.listings).where(eq(schema.listings.productId, productId));
  }

  async listAllByPlugin(pluginId: string): Promise<schema.Listing[]> {
    return this.db.select().from(schema.listings).where(eq(schema.listings.pluginId, pluginId));
  }

  async listByIds(ids: string[]): Promise<schema.Listing[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(schema.listings).where(inArray(schema.listings.id, ids));
  }

  /**
   * Fetch listings of one plugin whose internal `syncState.push_state` is in the
   * given set. Used by the Trendyol reconciliation cron to pick up batches awaiting
   * a poll / retry / approval check (the state lives in the DB → crash-safe).
   */
  async listByPushState(pluginId: string, states: string[]): Promise<schema.Listing[]> {
    if (states.length === 0) return [];
    return this.db
      .select()
      .from(schema.listings)
      .where(
        and(
          eq(schema.listings.pluginId, pluginId),
          inArray(sql`(${schema.listings.syncState} ->> 'push_state')`, states),
        ),
      );
  }

  async get(id: string): Promise<schema.Listing> {
    const rows = await this.db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw DomainError.notFound(`Listing not found: ${id}`);
    return row;
  }

  /**
   * Insert or update — UNIQUE on (product_id, plugin_id, platform) is the conflict target.
   */
  async upsert(input: UpsertListingDto): Promise<schema.Listing> {
    const [row] = await this.db
      .insert(schema.listings)
      .values({
        id: uuidv7(),
        productId: input.productId,
        pluginId: input.pluginId,
        externalListingId: input.externalListingId,
        platform: input.platform ?? '',
        status: input.status ?? 'draft',
        syncState: (input.syncState ?? {}) as schema.ListingSyncState,
      })
      .onConflictDoUpdate({
        target: [schema.listings.productId, schema.listings.pluginId, schema.listings.platform],
        set: {
          externalListingId: input.externalListingId,
          status: input.status ?? sql`${schema.listings.status}`,
          syncState: input.syncState
            ? (input.syncState as schema.ListingSyncState)
            : sql`${schema.listings.syncState}`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw DomainError.conflict('Upsert returned no row');
    const wasInserted = row.createdAt.getTime() === row.updatedAt.getTime();
    if (wasInserted) {
      this.events.emitFromPlatform('listing.created', { listingId: row.id });
    } else {
      const changes: string[] = ['externalListingId'];
      if (input.status !== undefined) changes.push('status');
      if (input.syncState !== undefined) changes.push('syncState');
      this.events.emitFromPlatform('listing.updated', { listingId: row.id, changes });
    }
    return row;
  }

  /**
   * Insert or update — UNIQUE on (plugin_id, external_listing_id) is the conflict target.
   *
   * Used by import pipelines where the external listing ID is the authoritative key.
   * On conflict the product link and sync state are refreshed (handles re-imports where
   * the same external listing may move to a different internal product).
   */
  async upsertByExternalId(input: UpsertListingDto): Promise<schema.Listing> {
    const [row] = await this.db
      .insert(schema.listings)
      .values({
        id: uuidv7(),
        productId: input.productId,
        pluginId: input.pluginId,
        externalListingId: input.externalListingId,
        platform: input.platform ?? '',
        status: input.status ?? 'draft',
        syncState: (input.syncState ?? {}) as schema.ListingSyncState,
      })
      .onConflictDoUpdate({
        target: [schema.listings.pluginId, schema.listings.externalListingId],
        set: {
          productId: input.productId,
          platform: input.platform ?? '',
          status: input.status ?? sql`${schema.listings.status}`,
          syncState: input.syncState
            ? (input.syncState as schema.ListingSyncState)
            : sql`${schema.listings.syncState}`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw DomainError.conflict('Upsert returned no row');
    const wasInserted = row.createdAt.getTime() === row.updatedAt.getTime();
    if (wasInserted) {
      this.events.emitFromPlatform('listing.created', { listingId: row.id });
    } else {
      const changes: string[] = ['productId', 'externalListingId'];
      if (input.status !== undefined) changes.push('status');
      if (input.syncState !== undefined) changes.push('syncState');
      this.events.emitFromPlatform('listing.updated', { listingId: row.id, changes });
    }
    return row;
  }

  async setSyncState(id: string, state: schema.ListingSyncState): Promise<schema.Listing> {
    const [row] = await this.db
      .update(schema.listings)
      .set({
        syncState: state,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.listings.id, id))
      .returning();
    if (!row) throw DomainError.notFound(`Listing not found: ${id}`);
    this.events.emitFromPlatform('listing.updated', {
      listingId: row.id,
      changes: ['syncState', 'lastSyncedAt'],
    });
    return row;
  }

  /**
   * Merge a partial set of user-editable fields into the listing's existing syncState.
   * Only provided (non-undefined) keys are overwritten; all other keys (images, category,
   * brand, handling_time_days, etc.) are preserved unchanged.
   * For the `temu` sub-object a nested merge is performed.
   */
  async mergeSyncState(id: string, patch: PatchSyncStateDto): Promise<schema.Listing> {
    const listing = await this.get(id);
    const current = listing.syncState;

    const next: schema.ListingSyncState = { ...current };

    if (patch.title !== undefined) next.title = patch.title;
    if (patch.description !== undefined) next.description = patch.description;
    if (patch.price_amount_minor !== undefined) next.price_amount_minor = patch.price_amount_minor;
    if (patch.price_currency !== undefined) next.price_currency = patch.price_currency;
    if (patch.stock_quantity !== undefined) next.stock_quantity = patch.stock_quantity;
    if (patch.characteristics !== undefined) next.characteristics = patch.characteristics;

    if (patch.temu !== undefined) {
      const currentTemu =
        current.temu && typeof current.temu === 'object'
          ? (current.temu as Record<string, unknown>)
          : {};
      const mergedTemu: Record<string, unknown> = { ...currentTemu };

      if (patch.temu.specDetails !== undefined) mergedTemu.specDetails = patch.temu.specDetails;

      if (patch.temu.goodsServicePromise !== undefined) {
        const currentGsp =
          currentTemu.goodsServicePromise && typeof currentTemu.goodsServicePromise === 'object'
            ? (currentTemu.goodsServicePromise as Record<string, unknown>)
            : {};
        mergedTemu.goodsServicePromise = {
          ...currentGsp,
          ...patch.temu.goodsServicePromise,
        };
      }

      next.temu = mergedTemu;
    }

    const saved = await this.setSyncState(id, next);
    // O editare de preț per-ofertă se propagă light către marketplace (fără
    // re-aprobare) prin PriceUpdateWorker.
    if (patch.price_amount_minor !== undefined) {
      await this.queue.enqueue<UpdatePriceJob>(UPDATE_PRICE_JOB, { listingId: id });
    }
    // O editare de stoc per-ofertă propagă DOAR pe acea ofertă (listingId).
    if (patch.stock_quantity !== undefined) {
      await this.queue.enqueue<UpdateStockJob>(UPDATE_STOCK_JOB, {
        productId: listing.productId,
        listingId: id,
      });
    }
    return saved;
  }

  /** Write back the outcome of an async marketplace push: status + sync state. */
  async applyPushResult(
    id: string,
    status: schema.Listing['status'],
    syncState: schema.ListingSyncState,
  ): Promise<schema.Listing> {
    const [row] = await this.db
      .update(schema.listings)
      .set({ status, syncState, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.listings.id, id))
      .returning();
    if (!row) throw DomainError.notFound(`Listing not found: ${id}`);
    this.events.emitFromPlatform('listing.updated', {
      listingId: row.id,
      changes: ['status', 'syncState'],
    });
    return row;
  }

  /**
   * Retrimite manual o ofertă din OpenSales: resetează starea (status `draft`,
   * push_state `pending`), curăță erorile de publicare, dar PĂSTREAZĂ
   * `universal_attr_ids` și `retry_round` (re-push-ul reaplică override-urile
   * „Universal”), apoi re-enqueue job-ul de push pentru această ofertă.
   */
  async repush(id: string): Promise<schema.Listing> {
    const listing = await this.get(id);
    const nextSyncState: schema.ListingSyncState = {
      ...listing.syncState,
      push_state: 'pending',
      last_error: null,
    };
    delete nextSyncState.push_failure_reasons;
    const updated = await this.applyPushResult(id, 'draft', nextSyncState);
    await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, {
      pluginId: listing.pluginId,
      marketplace: listing.platform,
      listingIds: [id],
    });
    return updated;
  }

  /**
   * Activează sau dezactivează o ofertă:
   *  - active=true  → repush (resetează la draft + requeue push job)
   *  - active=false → setează status `paused` local în DB
   */
  async setActive(id: string, active: boolean): Promise<schema.Listing> {
    if (active) return this.repush(id);
    const [row] = await this.db
      .update(schema.listings)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(schema.listings.id, id))
      .returning();
    if (!row) throw DomainError.notFound(`Listing not found: ${id}`);
    this.events.emitFromPlatform('listing.updated', { listingId: row.id, changes: ['status'] });
    return row;
  }

  async delete(id: string): Promise<void> {
    const rows = await this.db
      .delete(schema.listings)
      .where(eq(schema.listings.id, id))
      .returning({ id: schema.listings.id });
    if (rows.length === 0) throw DomainError.notFound(`Listing not found: ${id}`);
    const deleted = rows[0];
    if (deleted) {
      this.events.emitFromPlatform('listing.deleted', { listingId: deleted.id });
    }
  }
}
