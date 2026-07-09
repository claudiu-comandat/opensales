import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { desc, eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import { JobQueueService } from '../../jobs/job-queue.service.js';
import {
  MarketplaceEnablementService,
  unavailableMessage,
  type MarketplaceResolution,
} from '../marketplaces/marketplace-enablement.service.js';
import { ProductsService } from '../products/products.service.js';

import { pushImportSchema } from './dto/push-import.dto.js';
import { PushImportService } from './push-import.service.js';
import { IMPORT_BATCH_JOB, type ImportBatchJob } from './push-jobs.js';

import type {
  ImportBatchResponse,
  ImportBatchStatus,
  OfferResult,
  PushImportInput,
  SkuResult,
} from './dto/push-import.dto.js';

/** Câte produse procesează worker-ul într-o tură (progres + push grupat). */
const EXECUTE_CHUNK = 100;

@Injectable()
export class ImportBatchService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly products: ProductsService,
    private readonly enablement: MarketplaceEnablementService,
    private readonly queue: JobQueueService,
    private readonly pushImport: PushImportService,
    private readonly logger: Logger,
  ) {}

  /**
   * Faza sincronă: verificările făcute în bloc (2 query-uri, timp ~constant),
   * construiește planul per SKU, persistă lotul și pune procesarea în coadă.
   * Răspunde aproape instant indiferent de câte produse au fost trimise.
   */
  async planAndQueue(input: PushImportInput): Promise<ImportBatchResponse> {
    const results = await this.buildPlan(input);

    const id = uuidv7();
    await this.db.insert(schema.importBatches).values({
      id,
      status: 'processing',
      totalProducts: input.products.length,
      processedProducts: 0,
      results,
      input: toJsonSafe(input),
    });
    await this.queue.enqueue<ImportBatchJob>(IMPORT_BATCH_JOB, { batchId: id });

    return {
      batchId: id,
      status: 'processing',
      total: input.products.length,
      processed: 0,
      results,
    };
  }

  /** Construiește planul previzionat per SKU folosind doar verificări în bloc. */
  private async buildPlan(input: PushImportInput): Promise<SkuResult[]> {
    const skus = input.products.map((p) => p.sku);
    const eans = input.products
      .map((p) => p.ean)
      .filter((e): e is string => typeof e === 'string' && e.length > 0);

    const [existingBySku, existingByEan] = await Promise.all([
      this.products.findManyBySkus(skus),
      this.products.findManyByEans(eans),
    ]);
    const skuSet = new Set(existingBySku.map((p) => p.sku));
    const eanOwner = new Map(existingByEan.map((p) => [p.ean, p.sku]));

    // Rezolvă fiecare marketplace o singură dată (lookup plugin cachuit).
    const resolveCache = new Map<string, MarketplaceResolution>();
    const resolveOnce = async (code: string): Promise<MarketplaceResolution> => {
      const cached = resolveCache.get(code);
      if (cached) return cached;
      const res = await this.enablement.resolve(code);
      resolveCache.set(code, res);
      return res;
    };

    const results: SkuResult[] = [];
    for (const product of input.products) {
      let status: SkuResult['status'];
      let reason: string | undefined;
      if (skuSet.has(product.sku)) {
        // Prelistarea nu atinge produse existente — planul reflectă respingerea reală.
        status = input.prelist ? 'rejected' : 'conflict';
        reason = input.prelist
          ? 'SKU deja existent — prelistarea e doar pentru produse noi'
          : 'SKU deja existent';
      } else if (
        product.ean &&
        eanOwner.has(product.ean) &&
        eanOwner.get(product.ean) !== product.sku
      ) {
        status = 'rejected';
        reason = 'EAN deja existent';
      } else {
        status = 'created';
      }

      const offers: OfferResult[] = [];
      if (status !== 'rejected') {
        for (const offer of product.offers) {
          const res = await resolveOnce(offer.marketplace);
          if (res.ok) {
            offers.push({ marketplace: offer.marketplace, status: 'queued' });
          } else {
            offers.push({
              marketplace: offer.marketplace,
              status: 'ignored',
              reason: unavailableMessage(offer.marketplace, res.reason),
            });
          }
        }
      }
      results.push({ sku: product.sku, status, ...(reason ? { reason } : {}), offers });
    }
    return results;
  }

  /**
   * Faza asincronă (worker): procesează efectiv lotul, în bucăți, actualizând
   * progresul. Rezultatele reale per SKU suprascriu planul previzionat.
   */
  async executeBatch(batchId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(schema.importBatches)
      .where(eq(schema.importBatches.id, batchId))
      .limit(1);
    if (row?.status !== 'processing') return;

    let input: PushImportInput;
    try {
      input = pushImportSchema.parse(row.input);
    } catch (err) {
      await this.fail(batchId, err, []);
      return;
    }

    const accumulated: SkuResult[] = [];
    try {
      for (const chunk of chunkArray(input.products, EXECUTE_CHUNK)) {
        // prelist trebuie propagat per chunk — altfel flag-ul se pierde la re-împachetare.
        const res = await this.pushImport.import({ products: chunk, prelist: input.prelist });
        accumulated.push(...res.results);
        await this.db
          .update(schema.importBatches)
          .set({
            processedProducts: accumulated.length,
            results: accumulated,
            updatedAt: new Date(),
          })
          .where(eq(schema.importBatches.id, batchId));
      }
      await this.db
        .update(schema.importBatches)
        .set({
          status: 'completed',
          processedProducts: accumulated.length,
          results: accumulated,
          updatedAt: new Date(),
        })
        .where(eq(schema.importBatches.id, batchId));
    } catch (err) {
      await this.fail(batchId, err, accumulated);
    }
  }

  async getBatch(batchId: string): Promise<ImportBatchResponse | null> {
    const [row] = await this.db
      .select()
      .from(schema.importBatches)
      .where(eq(schema.importBatches.id, batchId))
      .limit(1);
    return row ? toResponse(row) : null;
  }

  /** Cel mai recent lot încă în procesare (pentru indicatorul din frontend). */
  async getActiveBatch(): Promise<ImportBatchResponse | null> {
    const [row] = await this.db
      .select()
      .from(schema.importBatches)
      .where(eq(schema.importBatches.status, 'processing'))
      .orderBy(desc(schema.importBatches.createdAt))
      .limit(1);
    return row ? toResponse(row) : null;
  }

  private async fail(batchId: string, err: unknown, partial: SkuResult[]): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error({ batchId, err: message }, 'import batch failed');
    await this.db
      .update(schema.importBatches)
      .set({
        status: 'failed',
        error: message,
        results: partial,
        processedProducts: partial.length,
        updatedAt: new Date(),
      })
      .where(eq(schema.importBatches.id, batchId));
  }
}

function toResponse(row: schema.ImportBatch): ImportBatchResponse {
  return {
    batchId: row.id,
    status: row.status as ImportBatchStatus,
    total: row.totalProducts,
    processed: row.processedProducts,
    results: row.results as SkuResult[],
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Clonă JSON-safe a input-ului (bigint → string), ca să intre în coloana jsonb. */
function toJsonSafe(input: PushImportInput): unknown {
  const json = JSON.stringify(input, (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  const parsed: unknown = JSON.parse(json);
  return parsed;
}
