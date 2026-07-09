import { Inject, Injectable } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { and, eq, sql } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';
import * as XLSX from 'xlsx';

import type { Database } from '@opensales/db';

// ── Constants ──────────────────────────────────────────────────────────────────

const EMAG_PACKAGE = '@opensales-plugin/emag';
const TRENDYOL_PACKAGE = '@opensales-plugin/trendyol';
const TEMU_PACKAGE = '@opensales-plugin/temu';

const SKIP_PRODUCT_COLS = new Set([
  'SKU',
  'Nume',
  'Descriere',
  'Preț redus',
  'Preț redus cu TVA',
  'Preț întreg',
  'Preț întreg cu TVA',
  'Imagini',
  // Dedicated product columns — handled explicitly, not stored in generic attributes
  'Stoc',
  'Stoc disponibil',
  'Stock',
  'EAN',
  'Cod EAN',
  'Brand',
  'Producător',
  'Producator',
  'Marca',
  'TVA',
  'TVA %',
  'Cota TVA',
  'Preț de achiziție',
  'Pret achizitie',
  'Preț achiziție',
  'Cost',
]);

// ── Public API ─────────────────────────────────────────────────────────────────

export interface EasysalesImportOptions {
  /** ISO 4217 currency code for product prices. Default: 'RON' */
  currency: string;
}

export interface EasysalesImportResult {
  productsCreated: number;
  productsUpdated: number;
  listingsCreated: number;
  listingsSkipped: number;
  errors: string[];
}

export interface EasysalesPrepareResult {
  sessionId: string;
}

// ── Staged session ─────────────────────────────────────────────────────────────

interface StagedSession {
  productRows: Record<string, unknown>[];
  offerRows: Record<string, unknown>[];
  createdAt: Date;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class EasysalesImportService {
  private readonly sessions = new Map<string, StagedSession>();

  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Classic one-shot import (still available for direct API / automated usage).
   */
  async processImport(
    productsBuffer: Buffer,
    offersBuffers: Buffer[],
    options: EasysalesImportOptions = { currency: 'RON' },
  ): Promise<EasysalesImportResult> {
    const productRows = parseExcel(productsBuffer);
    const offerRows: Record<string, unknown>[] = [];
    for (const buf of offersBuffers) {
      offerRows.push(...parseExcel(buf));
    }
    return this.processRows(productRows, offerRows, options);
  }

  /**
   * Step 1 of the two-phase import: upload files, parse XLSX, stage rows in
   * memory and return a session ID. No DB writes happen here.
   */
  prepareImport(productsBuffer: Buffer, offersBuffers: Buffer[]): EasysalesPrepareResult {
    const productRows = parseExcel(productsBuffer);
    const offerRows: Record<string, unknown>[] = [];
    for (const buf of offersBuffers) {
      offerRows.push(...parseExcel(buf));
    }

    const sessionId = uuidv7();
    this.sessions.set(sessionId, { productRows, offerRows, createdAt: new Date() });
    this.cleanupStaleSessions();

    this.logger.log(
      { sessionId, products: productRows.length, offers: offerRows.length },
      'EasySales import prepared',
    );
    return { sessionId };
  }

  /**
   * Step 2 of the two-phase import: retrieve staged rows and write them to DB.
   */
  async commitImport(
    sessionId: string,
    options: EasysalesImportOptions = { currency: 'RON' },
  ): Promise<EasysalesImportResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sesiunea de import a expirat sau nu există: ${sessionId}`);
    }
    this.sessions.delete(sessionId);
    return this.processRows(session.productRows, session.offerRows, options);
  }

  private cleanupStaleSessions(): void {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 h TTL
    for (const [id, session] of this.sessions) {
      if (session.createdAt < cutoff) this.sessions.delete(id);
    }
  }

  private async processRows(
    productRows: Record<string, unknown>[],
    offerRows: Record<string, unknown>[],
    options: EasysalesImportOptions,
  ): Promise<EasysalesImportResult> {
    const result: EasysalesImportResult = {
      productsCreated: 0,
      productsUpdated: 0,
      listingsCreated: 0,
      listingsSkipped: 0,
      errors: [],
    };

    this.logger.log(
      { products: productRows.length, offers: offerRows.length },
      'EasySales import started',
    );

    // Pre-load lookups
    const [existingProducts, pluginMap] = await Promise.all([
      this.db.select({ id: schema.products.id, sku: schema.products.sku }).from(schema.products),
      this.buildPluginMap(),
    ]);

    const skuToId = new Map(existingProducts.map((p) => [p.sku, p.id]));

    // ── 1. Upsert products ─────────────────────────────────────────────────
    for (const row of productRows) {
      try {
        await this.upsertProduct(row, options.currency, skuToId, result);
      } catch (err) {
        result.errors.push(`Produs: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Leagă retroactiv liniile de comandă orfane (comenzi importate ÎNAINTE de
    // produse → product_id NULL) de produsele tocmai upsert-ate, pe baza SKU-ului.
    // Un singur UPDATE set-based; idempotent — atinge doar liniile încă nelegate.
    await this.db.execute(
      sql`UPDATE order_items oi
          SET product_id = p.id
          FROM products p
          WHERE oi.product_id IS NULL AND oi.sku = p.sku`,
    );

    // Re-fetch so we can match offers → productId by SKU or EAN
    const allProducts = await this.db
      .select({
        id: schema.products.id,
        sku: schema.products.sku,
        attributes: schema.products.attributes,
      })
      .from(schema.products);

    const productLookup = new Map<string, string>();
    for (const p of allProducts) {
      productLookup.set(p.sku, p.id);
      const attrs = p.attributes as Record<string, unknown>;
      const eanVal = attrs.EAN ?? attrs.ean;
      const ean =
        typeof eanVal === 'string' || typeof eanVal === 'number' ? String(eanVal).trim() : '';
      if (ean) productLookup.set(ean, p.id);
    }

    // ── 2. Upsert listings ─────────────────────────────────────────────────
    for (const row of offerRows) {
      try {
        await this.upsertListing(row, productLookup, pluginMap, result);
      } catch (err) {
        result.errors.push(`Ofertă: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(result, 'EasySales import complete');
    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async upsertProduct(
    row: Record<string, unknown>,
    currency: string,
    skuToId: Map<string, string>,
    result: EasysalesImportResult,
  ): Promise<void> {
    const sku = str(row.SKU).trim();
    const name = str(row.Nume).trim();
    if (!sku || !name) {
      result.errors.push(`Rând ignorat — lipsesc SKU sau Nume: ${JSON.stringify(row)}`);
      return;
    }

    const priceStr = str(row['Preț redus'] ?? row['Preț redus cu TVA'] ?? '0').replace(/,/g, '.');
    const priceMinor = BigInt(Math.round(parseFloat(priceStr || '0') * 100));

    // ── Stock (column G in EasySales export) ────────────────────────────────
    const stockRaw = str(row.Stoc ?? row['Stoc disponibil'] ?? row.Stock ?? '0').replace(
      /[^\d]/g,
      '',
    );
    const stockQuantity = parseInt(stockRaw || '0', 10);

    // ── Dedicated fields ─────────────────────────────────────────────────────
    const brand =
      str(row.Brand ?? row['Producător'] ?? row.Producator ?? row.Marca ?? '').trim() || null;
    const ean = str(row.EAN ?? row['Cod EAN'] ?? '').trim() || null;
    const vatRaw = str(row.TVA ?? row['TVA %'] ?? row['Cota TVA'] ?? '').replace(/[^\d]/g, '');
    const vatRate = vatRaw ? parseInt(vatRaw, 10) : null;
    const purchasePriceRaw = str(
      row['Preț de achiziție'] ?? row['Pret achizitie'] ?? row['Preț achiziție'] ?? row.Cost ?? '',
    ).replace(/,/g, '.');
    const purchasePriceMinor = purchasePriceRaw
      ? BigInt(Math.round(parseFloat(purchasePriceRaw) * 100))
      : null;

    const imagesRaw = str(row.Imagini);
    const images = imagesRaw
      ? imagesRaw
          .split(',')
          .map((u) => u.trim())
          .filter(Boolean)
          .map((url) => ({ url }))
      : [];

    const attributes: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if (SKIP_PRODUCT_COLS.has(key)) continue;
      if (/^Prod ch\. \d+ name$/i.test(key)) {
        const valKey = key.replace(/name$/i, 'val.');
        const val = row[valKey];
        if (val !== undefined && val !== '') {
          attributes[str(row[key])] = val;
        }
      } else if (!/^Prod ch\. \d+ val\.$/i.test(key)) {
        if (row[key] !== undefined && row[key] !== '') {
          attributes[key] = row[key];
        }
      }
    }

    const existingId = skuToId.get(sku);
    if (existingId) {
      await this.db
        .update(schema.products)
        .set({
          name,
          description: str(row.Descriere) || null,
          priceAmountMinor: priceMinor,
          priceCurrency: currency,
          stockQuantity,
          images,
          attributes,
          brand,
          ean,
          vatRate,
          purchasePriceAmountMinor: purchasePriceMinor,
          updatedAt: new Date(),
        })
        .where(eq(schema.products.id, existingId));
      result.productsUpdated++;
    } else {
      const [inserted] = await this.db
        .insert(schema.products)
        .values({
          id: uuidv7(),
          sku,
          name,
          description: str(row.Descriere) || null,
          priceAmountMinor: priceMinor,
          priceCurrency: currency,
          stockQuantity,
          images,
          attributes,
          isActive: true,
          brand,
          ean,
          vatRate,
          purchasePriceAmountMinor: purchasePriceMinor,
        })
        .returning({ id: schema.products.id });
      if (inserted) skuToId.set(sku, inserted.id);
      result.productsCreated++;
    }
  }

  private async upsertListing(
    row: Record<string, unknown>,
    productLookup: Map<string, string>,
    pluginMap: Map<string, string>,
    result: EasysalesImportResult,
  ): Promise<void> {
    const detected = detectPlatform(row);
    if (!detected.pluginPackage || !detected.matchKey) {
      result.listingsSkipped++;
      return;
    }

    const pluginId = pluginMap.get(detected.pluginPackage);
    if (!pluginId) {
      result.errors.push(`Plugin neinstalat: ${detected.pluginPackage}`);
      result.listingsSkipped++;
      return;
    }

    const productId = productLookup.get(detected.matchKey);
    if (!productId) {
      result.errors.push(
        `Niciun produs găsit pentru "${detected.matchKey}" (plugin: ${detected.pluginPackage})`,
      );
      result.listingsSkipped++;
      return;
    }

    // Skip if listing already exists for this product+plugin pair
    const existing = await this.db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .where(and(eq(schema.listings.productId, productId), eq(schema.listings.pluginId, pluginId)))
      .limit(1);

    if (existing.length > 0) {
      result.listingsSkipped++;
      return;
    }

    const externalId = detected.externalId || `easysales-import-${uuidv7()}`;

    await this.db.insert(schema.listings).values({
      id: uuidv7(),
      productId,
      pluginId,
      externalListingId: externalId,
      status: 'active',
      syncState: {},
    });
    result.listingsCreated++;
  }

  private async buildPluginMap(): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: schema.plugins.id, packageName: schema.plugins.packageName })
      .from(schema.plugins);
    return new Map(rows.map((r) => [r.packageName, r.id]));
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function parseExcel(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
}

interface DetectedPlatform {
  pluginPackage: string | null;
  externalId: string;
  matchKey: string | null;
}

/**
 * Detects the marketplace platform from an EasySales offer row.
 *
 * Detection rules:
 *  - eMAG:     "Codul PNK din eMAG" is present
 *  - Trendyol: "ID Variație" is present OR "Magazin virtual" contains "trendyol"
 *  - Temu:     "Temu ID" / "Temu Product ID" is present OR "Magazin virtual" contains "temu"
 */
function detectPlatform(row: Record<string, unknown>): DetectedPlatform {
  const codPnk = str(row['Codul PNK din eMAG']).trim();
  const idVariatie = str(row['ID Variație']).trim();
  const idOferta = str(row['ID ofertă']).trim();
  const magazin = str(row['Magazin virtual']).toLowerCase();
  const ean = str(row.EAN).trim();
  const sku = str(row.SKU).trim();
  const temuId = str(row['Temu ID'] ?? row['Temu Product ID'] ?? row.temu_id ?? '').trim();

  if (codPnk) {
    return {
      pluginPackage: EMAG_PACKAGE,
      externalId: codPnk,
      matchKey: ean || sku || null,
    };
  }

  if (idVariatie || magazin.includes('trendyol')) {
    return {
      pluginPackage: TRENDYOL_PACKAGE,
      externalId: idVariatie || idOferta,
      matchKey: idOferta || ean || sku || null,
    };
  }

  if (temuId || magazin.includes('temu')) {
    return {
      pluginPackage: TEMU_PACKAGE,
      externalId: temuId || sku,
      matchKey: ean || sku || null,
    };
  }

  return { pluginPackage: null, externalId: '', matchKey: null };
}
