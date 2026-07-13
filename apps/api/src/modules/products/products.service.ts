import { Inject, Injectable } from '@nestjs/common';
import { schema, DB_TOKEN } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { and, desc, eq, exists, gt, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

export interface ProductStats {
  totalProducts: number;
  totalStock: number;
  lowStockCount: number;
  noStockCount: number;
}

import type { Database } from '@opensales/db';

import { DomainError } from '../../errors/domain.error.js';
import { JobQueueService } from '../../jobs/job-queue.service.js';
import { CurrencyService } from '../currency/currency.service.js';
import {
  UPDATE_PRICE_JOB,
  UPDATE_PRODUCT_CONTENT_JOB,
  UPDATE_STOCK_JOB,
  type UpdatePriceJob,
  type UpdateProductContentJob,
  type UpdateStockJob,
} from '../import/push-jobs.js';
import { ListingsService } from '../listings/listings.service.js';
import { marketplaceCurrency } from '../marketplaces/marketplace-catalog.js';
import { PluginEventsBus } from '../plugins/events/plugin-events.bus.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';

import type { UpsertProductInput } from '../import/emag-import.types.js';
import type { CreateProductDto } from './dto/create-product.dto.js';
import type { ListProductsDto } from './dto/list-products.dto.js';
import type { ListingInfo } from './dto/product-response.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';

export type ProductWithListings = schema.Product & { listings: ListingInfo[] };

/** Câte produse schimbate procesăm concurent per lot la stockSync. */
const STOCK_SYNC_BATCH_SIZE = 200;

/**
 * Fereastră de colapsare pentru save-uri rapide succesive (dublu-click, retry) pe
 * ACELAȘI produs/listing: pg-boss respinge un al doilea enqueue cu același
 * singletonKey în aceeași fereastră de N secunde (independent de policy-ul cozii —
 * vezi job_i4 în pg-boss), iar workerul citește oricum starea curentă la execuție,
 * deci un singur job ajunge să trimită valoarea FINALĂ.
 */
const SAVE_DEDUP_WINDOW_SECONDS = 5;

/** Stringify determinist — sortează cheile obiectelor (nu și ale array-urilor, unde
 * ordinea contează), ca reordonarea cheilor JSONB de către Postgres să nu producă
 * fals-pozitive la diff (attributes, images). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly events: PluginEventsBus,
    private readonly queue: JobQueueService,
    private readonly listings: ListingsService,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly currency: CurrencyService,
    private readonly logger: Logger,
  ) {}

  async list(input: ListProductsDto): Promise<{ data: ProductWithListings[]; total: number }> {
    const filters = [];
    if (input.search) {
      const pattern = `%${input.search}%`;
      const expr = or(ilike(schema.products.name, pattern), ilike(schema.products.sku, pattern));
      if (expr) filters.push(expr);
    }
    if (input.isActive !== undefined) filters.push(eq(schema.products.isActive, input.isActive));
    if (input.marketplace) {
      // Keep only products that have at least one listing on the given marketplace.
      filters.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(schema.listings)
            .where(
              and(
                eq(schema.listings.productId, schema.products.id),
                eq(schema.listings.platform, input.marketplace),
              ),
            ),
        ),
      );
    }
    if (input.listingStatus) {
      // Keep only products that have at least one listing with the given status.
      filters.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(schema.listings)
            .where(
              and(
                eq(schema.listings.productId, schema.products.id),
                eq(schema.listings.status, input.listingStatus as schema.Listing['status']),
              ),
            ),
        ),
      );
    }
    if (input.relevantOnly) {
      // Exclude products with stock 0 for more than 14 days.
      const expr = or(
        gt(schema.products.stockQuantity, 0),
        isNull(schema.products.stockZeroSince),
        sql`${schema.products.stockZeroSince} > NOW() - INTERVAL '14 days'`,
      );
      if (expr) filters.push(expr);
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.products)
        .where(where)
        .orderBy(desc(schema.products.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.products)
        .where(where),
    ]);

    const listingsMap = await this.getListingsFor(rows.map((r) => r.id));
    return {
      data: rows.map((r) => ({ ...r, listings: listingsMap.get(r.id) ?? [] })),
      total: totalRows[0]?.count ?? 0,
    };
  }

  async get(id: string): Promise<ProductWithListings> {
    const rows = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);
    const p = rows[0];
    if (!p) throw DomainError.notFound(`Product not found: ${id}`);
    const listingsMap = await this.getListingsFor([id]);
    return { ...p, listings: listingsMap.get(id) ?? [] };
  }

  async create(input: CreateProductDto): Promise<schema.Product> {
    try {
      const [row] = await this.db
        .insert(schema.products)
        .values({
          id: uuidv7(),
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          priceAmountMinor: input.priceAmountMinor,
          priceCurrency: input.priceCurrency,
          stockQuantity: input.stockQuantity,
          stockZeroSince: input.stockQuantity === 0 ? new Date() : null,
          images: input.images,
          attributes: input.attributes,
          isActive: input.isActive,
          brand: input.brand ?? null,
          ean: input.ean ?? null,
          vatRate: input.vatRate ?? null,
          purchasePriceAmountMinor: input.purchasePriceAmountMinor ?? null,
          fullPriceAmountMinor: input.fullPriceAmountMinor ?? null,
          weightGrams: input.weightGrams ?? null,
          heightMm: input.heightMm ?? null,
          widthMm: input.widthMm ?? null,
          lengthMm: input.lengthMm ?? null,
          warrantyMonths: input.warrantyMonths ?? null,
          handlingTimeDays: input.handlingTimeDays ?? null,
          numberOfPackages: input.numberOfPackages ?? null,
        })
        .returning();
      if (!row) throw DomainError.conflict('Insert returned no row');
      this.events.emitFromPlatform('product.created', { productId: row.id, sku: row.sku });
      await this.linkOrphanOrderItems(row.id, row.sku);
      return row;
    } catch (err) {
      if (err instanceof DomainError) throw err;
      if (isEanUniqueError(err)) throw DomainError.conflict(`EAN already exists: ${input.ean}`);
      if (isUniqueError(err)) throw DomainError.conflict(`SKU already exists: ${input.sku}`);
      throw err;
    }
  }

  async findBySku(sku: string): Promise<schema.Product | null> {
    const row = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.sku, sku))
      .limit(1);
    return row[0] ?? null;
  }

  async findByEan(ean: string): Promise<schema.Product | null> {
    const row = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.ean, ean))
      .limit(1);
    return row[0] ?? null;
  }

  /**
   * Batched existence check by SKU — one query for many SKUs.
   * Used by the async import planner to avoid N sequential round-trips.
   */
  async findManyBySkus(skus: string[]): Promise<{ id: string; sku: string }[]> {
    if (skus.length === 0) return [];
    return this.db
      .select({ id: schema.products.id, sku: schema.products.sku })
      .from(schema.products)
      .where(inArray(schema.products.sku, skus));
  }

  /** Batch-load full products by ID — single query, no listings join. */
  async getMany(ids: string[]): Promise<schema.Product[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(schema.products).where(inArray(schema.products.id, ids));
  }

  /** Batched existence check by EAN — one query for many EANs (non-null). */
  async findManyByEans(eans: string[]): Promise<{ sku: string; ean: string }[]> {
    if (eans.length === 0) return [];
    const rows = await this.db
      .select({ sku: schema.products.sku, ean: schema.products.ean })
      .from(schema.products)
      .where(inArray(schema.products.ean, eans));
    return rows.flatMap((r) => (r.ean !== null ? [{ sku: r.sku, ean: r.ean }] : []));
  }

  /**
   * Find a product by SKU, creating it if it does not exist.
   * If a row already exists the existing data is returned unchanged —
   * the caller's input is only used for the initial insert.
   * Used by Trendyol import so platform data is never overwritten.
   */
  async findOrCreateBySku(input: UpsertProductInput): Promise<schema.Product> {
    const product = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.products)
        .where(eq(schema.products.sku, input.sku))
        .limit(1);
      if (existing) return existing;
      const [created] = await tx
        .insert(schema.products)
        .values({
          id: uuidv7(),
          sku: input.sku,
          name: input.name,
          description: input.description,
          priceAmountMinor: input.priceAmountMinor,
          priceCurrency: input.priceCurrency,
          stockQuantity: input.stockQuantity,
          stockZeroSince: input.stockQuantity === 0 ? new Date() : null,
          images: input.images,
          attributes: input.attributes,
          isActive: true,
          brand: input.brand,
          ean: input.ean,
          vatRate: input.vatRate,
        })
        .returning();
      if (!created) throw DomainError.conflict('Insert returned no row');
      this.events.emitFromPlatform('product.created', { productId: created.id, sku: created.sku });
      return created;
    });
    await this.linkOrphanOrderItems(product.id, product.sku);
    return product;
  }

  /**
   * Upsert a product matched by SKU.
   *
   * If a row with the same SKU exists, every mutable field is rewritten
   * (excluding `createdAt`); otherwise a fresh row is inserted with a new
   * UUID v7. Wrapped in a transaction so the select + write are atomic
   * against concurrent imports.
   *
   * Used by the eMAG import pipeline — see `EmagImportService`.
   */
  async upsertBySku(input: UpsertProductInput): Promise<schema.Product> {
    const product = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.products)
        .where(eq(schema.products.sku, input.sku))
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(schema.products)
          .set({
            name: input.name,
            description: input.description,
            priceAmountMinor: input.priceAmountMinor,
            priceCurrency: input.priceCurrency,
            stockQuantity: input.stockQuantity,
            stockZeroSince:
              input.stockQuantity === 0
                ? sql`COALESCE(${schema.products.stockZeroSince}, NOW())`
                : null,
            images: input.images,
            attributes: input.attributes,
            brand: input.brand,
            ean: input.ean,
            vatRate: input.vatRate,
            updatedAt: new Date(),
          })
          .where(eq(schema.products.id, existing.id))
          .returning();
        if (!updated) throw DomainError.conflict('Upsert returned no row');
        this.events.emitFromPlatform('product.updated', {
          productId: updated.id,
          changes: ['name', 'description', 'priceAmountMinor', 'stockQuantity', 'attributes'],
        });
        return updated;
      }

      const [created] = await tx
        .insert(schema.products)
        .values({
          id: uuidv7(),
          sku: input.sku,
          name: input.name,
          description: input.description,
          priceAmountMinor: input.priceAmountMinor,
          priceCurrency: input.priceCurrency,
          stockQuantity: input.stockQuantity,
          stockZeroSince: input.stockQuantity === 0 ? new Date() : null,
          images: input.images,
          attributes: input.attributes,
          isActive: true,
          brand: input.brand,
          ean: input.ean,
          vatRate: input.vatRate,
        })
        .returning();
      if (!created) throw DomainError.conflict('Insert returned no row');
      this.events.emitFromPlatform('product.created', {
        productId: created.id,
        sku: created.sku,
      });
      return created;
    });
    await this.linkOrphanOrderItems(product.id, product.sku);
    return product;
  }

  /**
   * Leagă retroactiv liniile de comandă orfane (`product_id` NULL) de un produs,
   * pe baza SKU-ului. Necesar când comenzile sunt importate ÎNAINTE de produse:
   * la sync-ul comenzii `order_items.product_id` rămâne NULL (produsul nu exista
   * încă) și nu se mai reface altfel — astfel imaginea/numele canonic și scăderea
   * de stoc la factură lipsesc. Rulat după fiecare create/upsert de produs.
   * Idempotent: atinge doar liniile încă nelegate cu același SKU.
   */
  private async linkOrphanOrderItems(productId: string, sku: string): Promise<void> {
    await this.db
      .update(schema.orderItems)
      .set({ productId })
      .where(and(isNull(schema.orderItems.productId), eq(schema.orderItems.sku, sku)));
  }

  /**
   * Update only the stock quantity for a product matched by SKU.
   * Used by the push-import conflict path (existing SKU → refresh stock only).
   * Returns the updated product, or null if no product has that SKU.
   */
  async updateStockBySku(sku: string, stockQuantity: number): Promise<schema.Product | null> {
    const [row] = await this.db
      .update(schema.products)
      .set({
        stockQuantity: sql`${schema.products.stockQuantity} + ${stockQuantity}`,
        stockZeroSince: sql`CASE WHEN ${schema.products.stockQuantity} + ${stockQuantity} <= 0 THEN COALESCE(${schema.products.stockZeroSince}, NOW()) ELSE NULL END`,
        updatedAt: new Date(),
      })
      .where(eq(schema.products.sku, sku))
      .returning();
    if (!row) return null;
    this.events.emitFromPlatform('product.updated', {
      productId: row.id,
      changes: ['stockQuantity'],
    });
    return row;
  }

  /**
   * Ca `updateStockBySku`, dar deduplicat pe (sku, sourceOrderId): dacă aceeași
   * comandă a mai contribuit deja cu stoc la acest SKU, delta NU se mai aplică
   * a doua oară (retry/dublu-click/re-rulare = no-op sigur, inclusiv sub concurență,
   * datorită constraint-ului unic verificat în aceeași tranzacție). O comandă
   * DIFERITĂ pentru același SKU tot se adaugă normal — cheia e (sku, sourceOrderId),
   * nu doar sku.
   *
   * Fără `sourceOrderId` (apelanți vechi, sau fluxuri fără concept de comandă sursă),
   * cade pe `updateStockBySku` neschimbată.
   */
  async applyStockContributionBySku(
    sku: string,
    sourceOrderId: string | undefined,
    stockQuantity: number,
  ): Promise<{ product: schema.Product | null; applied: boolean }> {
    if (!sourceOrderId) {
      const product = await this.updateStockBySku(sku, stockQuantity);
      return { product, applied: product !== null };
    }

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.products)
        .where(eq(schema.products.sku, sku))
        .limit(1);
      if (!existing) return { product: null, applied: false };

      const [contribution] = await tx
        .insert(schema.stockContributions)
        .values({
          id: uuidv7(),
          productId: existing.id,
          sku,
          sourceOrderId,
          quantityApplied: stockQuantity,
        })
        .onConflictDoNothing({
          target: [schema.stockContributions.sku, schema.stockContributions.sourceOrderId],
        })
        .returning();
      if (!contribution) return { product: existing, applied: false };

      const [row] = await tx
        .update(schema.products)
        .set({
          stockQuantity: sql`${schema.products.stockQuantity} + ${stockQuantity}`,
          stockZeroSince: sql`CASE WHEN ${schema.products.stockQuantity} + ${stockQuantity} <= 0 THEN COALESCE(${schema.products.stockZeroSince}, NOW()) ELSE NULL END`,
          updatedAt: new Date(),
        })
        .where(eq(schema.products.sku, sku))
        .returning();
      if (!row) throw DomainError.conflict('Stock update returned no row');
      this.events.emitFromPlatform('product.updated', {
        productId: row.id,
        changes: ['stockQuantity'],
      });
      return { product: row, applied: true };
    });
  }

  /**
   * Aplică modificările unui produs în DB (doar câmpurile prezente), emite
   * `product.updated`, și — dacă stocul s-a schimbat — enqueue UPDATE_STOCK_JOB.
   * NU enqueue-uiește job-ul de conținut: caller-ul decide (single vs. bulk) ca
   * să poată agrega apelurile marketplace. Întoarce `null` dacă produsul lipsește.
   */
  /** Câmpuri de preț — au push light dedicat (propagatePriceOnly), nu re-push de conținut. */
  private static readonly PRICE_FIELDS: ReadonlySet<string> = new Set([
    'priceAmountMinor',
    'priceCurrency',
    'vatRate',
  ]);

  /** Compară valori: deep (JSON determinist) pentru array/obiect (images, attributes), strict altfel. */
  private static valueChanged(prior: unknown, next: unknown): boolean {
    if (prior === next) return false;
    if (typeof prior === 'object' || typeof next === 'object') {
      return stableStringify(prior) !== stableStringify(next);
    }
    return true;
  }

  /**
   * Aplică update-ul în DB și calculează câmpurile REALMENTE schimbate — valoare vs.
   * valoare, nu doar prezență în body. Formularul de edit retrimite tot obiectul
   * produsului la fiecare save, deci un diff pe simplă prezență ar declanșa re-push
   * complet de conținut chiar și când s-a modificat doar stocul sau prețul.
   */
  private async applyUpdate(
    id: string,
    input: UpdateProductDto,
  ): Promise<{ row: schema.Product; changedFields: string[] } | null> {
    const [prior] = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);
    if (!prior) return null;

    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    const changedFields: string[] = [];
    const consider = <K extends keyof schema.Product>(
      key: K,
      value: schema.Product[K] | undefined,
    ): void => {
      if (value === undefined) return;
      updateSet[key] = value;
      if (ProductsService.valueChanged(prior[key], value)) changedFields.push(key);
    };

    consider('sku', input.sku);
    consider('name', input.name);
    consider('description', input.description);
    consider('priceAmountMinor', input.priceAmountMinor);
    consider('priceCurrency', input.priceCurrency);
    if (input.stockQuantity !== undefined) {
      consider('stockQuantity', input.stockQuantity);
      // Track when stock hits 0; preserve existing timestamp if already 0.
      updateSet.stockZeroSince =
        input.stockQuantity === 0 ? sql`COALESCE(${schema.products.stockZeroSince}, NOW())` : null;
    }
    consider('images', input.images);
    consider('attributes', input.attributes);
    consider('isActive', input.isActive);
    consider('brand', input.brand);
    consider('ean', input.ean);
    consider('vatRate', input.vatRate);
    consider('purchasePriceAmountMinor', input.purchasePriceAmountMinor);
    consider('fullPriceAmountMinor', input.fullPriceAmountMinor);
    consider('weightGrams', input.weightGrams);
    consider('heightMm', input.heightMm);
    consider('widthMm', input.widthMm);
    consider('lengthMm', input.lengthMm);
    consider('warrantyMonths', input.warrantyMonths);
    consider('handlingTimeDays', input.handlingTimeDays);
    consider('numberOfPackages', input.numberOfPackages);

    let row: schema.Product | undefined;
    try {
      [row] = await this.db
        .update(schema.products)
        .set(updateSet as typeof schema.products.$inferInsert)
        .where(eq(schema.products.id, id))
        .returning();
    } catch (err) {
      if (isSkuUniqueError(err)) throw DomainError.conflict(`SKU already exists: ${input.sku}`);
      throw err;
    }
    if (!row) return null;

    this.events.emitFromPlatform('product.updated', { productId: row.id, changes: changedFields });
    // Stoc schimbat la nivel de produs → propagă pe TOATE ofertele (fără listingId).
    // singletonKey: dacă un job anterior pentru acest produs e încă în coadă/activ,
    // enqueue-ul e no-op — workerul citește stocul curent la execuție, deci un singur
    // job ajunge să trimită oricum valoarea FINALĂ (safe să colapseze save-uri rapide).
    if (changedFields.includes('stockQuantity')) {
      await this.queue.enqueue<UpdateStockJob>(
        UPDATE_STOCK_JOB,
        { productId: row.id },
        { singletonKey: row.id, singletonSeconds: SAVE_DEDUP_WINDOW_SECONDS },
      );
    }
    return { row, changedFields };
  }

  /** True dacă vreun câmp de CONȚINUT (nu stoc, nu preț — au push light dedicat) s-a schimbat. */
  private contentChanged(changedFields: string[]): boolean {
    return changedFields.some((k) => k !== 'stockQuantity' && !ProductsService.PRICE_FIELDS.has(k));
  }

  async update(id: string, input: UpdateProductDto): Promise<schema.Product> {
    const result = await this.applyUpdate(id, input);
    if (!result) throw DomainError.notFound(`Product not found: ${id}`);
    const { row, changedFields } = result;

    // Preț/TVA schimbat → push LIGHT per-ofertă (fără re-validare documentație), NU
    // re-push complet de conținut — altfel o simplă schimbare de preț ar suprascrie
    // titlu/poze/descriere pe fiecare ofertă (inclusiv valori setate manual direct pe
    // marketplace și trase înapoi prin resincronizare).
    if (changedFields.some((k) => ProductsService.PRICE_FIELDS.has(k))) {
      await this.propagatePriceOnly(row);
    }

    // Conținut modificat → suprascrie ofertele cu datele produsului și re-push pe
    // eMAG (product_offer/save) + Trendyol (content-bulk / unapproved-bulk).
    if (this.contentChanged(changedFields)) {
      await this.queue.enqueue<UpdateProductContentJob>(UPDATE_PRODUCT_CONTENT_JOB, {
        items: [{ productId: row.id, changedFields }],
      });
    }
    return row;
  }

  /**
   * Propagă prețul curent al produsului (convertit în moneda fiecărei piețe) pe
   * TOATE ofertele lui, ca override per-listing, și enqueue-uiește push-ul light
   * (UPDATE_PRICE_JOB → PriceUpdateWorker: eMAG offer/save, Trendyol
   * price-and-inventory, Temu partial.update — niciunul nu re-declanșează validarea
   * de documentație). Oglindește OfferPriceService.setPriceForProduct, folosit acolo
   * pentru setarea manuală pe toate ofertele; aici pentru propagarea automată la PATCH.
   */
  private async propagatePriceOnly(product: schema.Product): Promise<void> {
    const listings = await this.listings.listByProduct(product.id);
    for (const listing of listings) {
      try {
        const isTemu = listing.platform.startsWith('temu-');
        const target = isTemu ? 'RON' : (marketplaceCurrency(listing.platform) ?? 'RON');
        const converted =
          target === product.priceCurrency
            ? product.priceAmountMinor
            : await this.currency.convertMinor(
                product.priceAmountMinor,
                product.priceCurrency,
                target,
              );
        await this.listings.setSyncState(listing.id, {
          ...listing.syncState,
          price_amount_minor: String(converted),
          price_currency: target,
        });
        await this.queue.enqueue<UpdatePriceJob>(
          UPDATE_PRICE_JOB,
          { listingId: listing.id },
          { singletonKey: listing.id, singletonSeconds: SAVE_DEDUP_WINDOW_SECONDS },
        );
      } catch (err) {
        // O ofertă cu probleme (ex. ștearsă concurent) nu trebuie să blocheze restul
        // ofertelor sau enqueue-ul job-ului de conținut pentru alte câmpuri din același request.
        this.logger.warn(
          {
            listingId: listing.id,
            productId: product.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'propagatePriceOnly: push de preț eșuat pentru o ofertă, continuăm cu celelalte',
        );
      }
    }
  }

  /**
   * Bulk update: aplică modificările pe mai multe produse și enqueue-uiește UN
   * SINGUR job de conținut cu toate produsele, ca worker-ul să agrege apelurile
   * marketplace (eMAG 50/req, Trendyol 1000/req) în loc de unul per produs.
   */
  async updateMany(
    updates: (UpdateProductDto & { id: string })[],
  ): Promise<{ updated: number; notFound: string[] }> {
    const notFound: string[] = [];
    const contentItems: { productId: string; changedFields: string[] }[] = [];
    let updated = 0;
    for (const upd of updates) {
      const { id, ...input } = upd;
      const result = await this.applyUpdate(id, input);
      if (!result) {
        notFound.push(id);
        continue;
      }
      updated++;
      const { row, changedFields } = result;
      if (changedFields.some((k) => ProductsService.PRICE_FIELDS.has(k))) {
        await this.propagatePriceOnly(row);
      }
      if (this.contentChanged(changedFields)) {
        contentItems.push({ productId: row.id, changedFields });
      }
    }
    if (contentItems.length > 0) {
      await this.queue.enqueue<UpdateProductContentJob>(UPDATE_PRODUCT_CONTENT_JOB, {
        items: contentItems,
      });
    }
    return { updated, notFound };
  }

  /**
   * Scrie conținut tras DE PE un marketplace (ex. asociere eMAG) pe produs —
   * update DB simplu, FĂRĂ a enqueue-ui re-push (altfel s-ar relua un ciclu de
   * push către marketplace). `partNumberKey` se merge-uiește în `attributes`.
   */
  async applyMarketplaceContent(
    id: string,
    content: {
      name?: string;
      description?: string | null;
      brand?: string;
      images?: { url: string }[];
      partNumberKey?: string;
    },
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (content.name !== undefined) set.name = content.name;
    if (content.description !== undefined) set.description = content.description;
    if (content.brand !== undefined) set.brand = content.brand;
    if (content.images !== undefined) set.images = content.images;
    if (content.partNumberKey !== undefined) {
      const cur = await this.db
        .select({ attributes: schema.products.attributes })
        .from(schema.products)
        .where(eq(schema.products.id, id))
        .limit(1);
      const attrs = (cur[0]?.attributes ?? {}) as Record<string, unknown>;
      set.attributes = { ...attrs, part_number_key: content.partNumberKey };
    }
    await this.db.update(schema.products).set(set).where(eq(schema.products.id, id));
  }

  /** EAN + SKU per produs, non-null, ordonat după EAN. */
  async listEanSkus(): Promise<{ ean: string; sku: string }[]> {
    const rows = await this.db
      .select({ ean: schema.products.ean, sku: schema.products.sku })
      .from(schema.products)
      .where(isNotNull(schema.products.ean))
      .orderBy(schema.products.ean);
    return rows.flatMap((r) => (r.ean !== null ? [{ ean: r.ean, sku: r.sku }] : []));
  }

  /** Toate EAN-urile distincte, non-null, ordonate alfabetic. */
  async listEans(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ ean: schema.products.ean })
      .from(schema.products)
      .where(isNotNull(schema.products.ean))
      .orderBy(schema.products.ean);
    return rows.flatMap((r) => (r.ean !== null ? [r.ean] : []));
  }

  async stats(): Promise<ProductStats> {
    const [result] = await this.db
      .select({
        totalProducts: sql<number>`count(*)::int`,
        totalStock: sql<number>`coalesce(sum(stock_quantity), 0)::int`,
        lowStockCount: sql<number>`count(*) filter (where stock_quantity > 0 and stock_quantity < 5)::int`,
        noStockCount: sql<number>`count(*) filter (where stock_quantity = 0)::int`,
      })
      .from(schema.products);
    return result ?? { totalProducts: 0, totalStock: 0, lowStockCount: 0, noStockCount: 0 };
  }

  async stockSync(
    items: { sku: string; quantity: number }[],
  ): Promise<{ updated: number; zeroed: number; skipped: number; total: number }> {
    const allProducts = await this.db
      .select({
        id: schema.products.id,
        sku: schema.products.sku,
        stock: schema.products.stockQuantity,
      })
      .from(schema.products);

    const incomingMap = new Map<string, number>(items.map((it) => [it.sku, it.quantity]));

    const changed = allProducts
      .map((product) => {
        const incoming = incomingMap.get(product.sku);
        const newQty = incoming ?? 0;
        return newQty === product.stock
          ? null
          : { product, newQty, isUpdate: incoming !== undefined };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    let updated = 0;
    let zeroed = 0;

    // Loturi mărginite (nu tot catalogul deodată) — evită mii de round-trip-uri
    // secvențiale la DB+coadă pe un singur request HTTP de stock sync.
    for (const batch of chunk(changed, STOCK_SYNC_BATCH_SIZE)) {
      await Promise.all(
        batch.map(async ({ product, newQty, isUpdate }) => {
          await this.db
            .update(schema.products)
            .set({ stockQuantity: newQty, updatedAt: new Date() })
            .where(eq(schema.products.id, product.id));
          await this.queue.enqueue<UpdateStockJob>(UPDATE_STOCK_JOB, { productId: product.id });
          if (isUpdate) updated++;
          else zeroed++;
        }),
      );
    }

    return {
      updated,
      zeroed,
      skipped: allProducts.length - changed.length,
      total: allProducts.length,
    };
  }

  async deleteAll(): Promise<number> {
    const rows = await this.db
      .delete(schema.products)
      .returning({ id: schema.products.id, sku: schema.products.sku });
    for (const r of rows) {
      this.events.emitFromPlatform('product.deleted', { productId: r.id, sku: r.sku });
    }
    return rows.length;
  }

  /**
   * Trece pe End-of-Life (status 2, light offer/save) fiecare ofertă eMAG/FD a
   * produsului — inclusiv cele încă în validare — ÎNAINTE de ștergere. Orice eroare
   * aici oprește ștergerea (produsul rămâne intact), ca să nu pierdem legătura cu o
   * ofertă eMAG orfană pe care nu mai putem identifica ulterior (fără stockCode).
   */
  private async deactivateEmagListings(product: schema.Product): Promise<void> {
    if (product.stockCode === null) return; // nicio ofertă eMAG nu a fost trimisă vreodată
    const listings = await this.listings.listByProduct(product.id);
    const emagListings = listings.filter(
      (l) => l.platform.startsWith('emag-') || l.platform.startsWith('fd-'),
    );
    for (const listing of emagListings) {
      const plugin = await this.registry.findById(listing.pluginId);
      const loaded = this.loaded.getById(listing.pluginId);
      if (plugin?.status !== 'active' || !loaded) {
        throw DomainError.conflict(
          `Plugin eMAG indisponibil (${listing.platform}) — nu pot confirma EOL înainte de ștergere`,
        );
      }
      try {
        await invokeAction(loaded.instance, 'pushOffer', {
          mode: 'light',
          payload: { id: product.stockCode, status: 2 },
          platform: listing.platform,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw DomainError.conflict(
          `EOL eMAG eșuat pentru ${listing.platform} (id ${product.stockCode}): ${message}`,
        );
      }
    }
  }

  async delete(id: string): Promise<void> {
    const existingRows = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) throw DomainError.notFound(`Product not found: ${id}`);

    await this.deactivateEmagListings(existing);

    try {
      const rows = await this.db
        .delete(schema.products)
        .where(eq(schema.products.id, id))
        .returning({ id: schema.products.id, sku: schema.products.sku });
      if (rows.length === 0) throw DomainError.notFound(`Product not found: ${id}`);
      const deleted = rows[0];
      if (deleted) {
        this.events.emitFromPlatform('product.deleted', {
          productId: deleted.id,
          sku: deleted.sku,
        });
      }
    } catch (err) {
      if (err instanceof DomainError) throw err;
      if (isFkViolation(err)) {
        throw DomainError.conflict('Cannot delete product referenced by order items');
      }
      throw err;
    }
  }

  async getManyWithListings(ids: string[]): Promise<ProductWithListings[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(schema.products)
      .where(inArray(schema.products.id, ids));
    const listingsMap = await this.getListingsFor(ids);
    return rows.map((r) => ({ ...r, listings: listingsMap.get(r.id) ?? [] }));
  }

  private async getListingsFor(productIds: string[]): Promise<Map<string, ListingInfo[]>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        productId: schema.listings.productId,
        id: schema.listings.id,
        pluginId: schema.listings.pluginId,
        pluginPackage: schema.plugins.packageName,
        platform: schema.listings.platform,
        syncState: schema.listings.syncState,
        status: schema.listings.status,
      })
      .from(schema.listings)
      .innerJoin(schema.plugins, eq(schema.listings.pluginId, schema.plugins.id))
      .where(inArray(schema.listings.productId, productIds));

    const map = new Map<string, ListingInfo[]>();
    for (const r of rows) {
      const list = map.get(r.productId) ?? [];
      list.push({
        id: r.id,
        pluginId: r.pluginId,
        pluginPackage: r.pluginPackage,
        platform: r.platform,
        syncState: r.syncState,
        status: r.status,
      });
      map.set(r.productId, list);
    }
    return map;
  }
}

function isUniqueError(err: unknown): boolean {
  return err instanceof Error && /unique|duplicate/i.test(err.message);
}

function isEanUniqueError(err: unknown): boolean {
  return err instanceof Error && /products_ean_unique/i.test(err.message);
}

function isSkuUniqueError(err: unknown): boolean {
  return err instanceof Error && /products_sku_unique/i.test(err.message);
}

function isFkViolation(err: unknown): boolean {
  return err instanceof Error && /foreign key|violates/i.test(err.message);
}
