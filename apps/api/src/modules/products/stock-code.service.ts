import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { eq, sql } from 'drizzle-orm';

import { DomainError } from '../../errors/domain.error.js';

/**
 * Limita superioară acceptată de eMAG API pentru câmpul `id` din product_offer/save.
 * Doc v4.5.1: "Required. Integer value between 1 and 16777215."
 */
export const MAX_STOCK_CODE = 16_777_215;

const ALLOC_LOCK_KEY = 918273645;

@Injectable()
export class StockCodeService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  /**
   * Returnează stockCode-ul produsului. Dacă nu are încă unul, alocă primul slot
   * liber din intervalul 1..MAX_STOCK_CODE (prima valoare absentă atât din
   * products.stock_code cât și din listings.sync_state.emag_offer_id). Alocarea
   * e serializată prin pg_advisory_xact_lock — niciun produs nu primește același cod.
   */
  async ensureForProduct(productId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ALLOC_LOCK_KEY})`);

      const [existing] = await tx
        .select({ stockCode: schema.products.stockCode })
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1);
      if (!existing) throw DomainError.notFound(`Product not found: ${productId}`);
      if (existing.stockCode !== null) return existing.stockCode;

      const productRows = await tx
        .select({ n: schema.products.stockCode })
        .from(schema.products)
        .where(sql`${schema.products.stockCode} BETWEEN 1 AND ${MAX_STOCK_CODE}`);

      const listingRows = await tx.execute<{ n: number | null }>(sql`
        SELECT DISTINCT (sync_state->>'emag_offer_id')::int AS n
        FROM listings
        WHERE sync_state->>'emag_offer_id' ~ '^[0-9]+$'
          AND (sync_state->>'emag_offer_id')::bigint BETWEEN 1 AND ${MAX_STOCK_CODE}
      `);

      const usedCodes = [
        ...productRows.map((r) => r.n),
        ...listingRows.map((r) => (r.n !== null ? Number(r.n) : null)),
      ].filter((n): n is number => n !== null);

      const next = firstFreeInRange(usedCodes);

      await tx
        .update(schema.products)
        .set({ stockCode: next, updatedAt: new Date() })
        .where(eq(schema.products.id, productId));
      return next;
    });
  }

  /**
   * Read-only: întoarce primul slot liber FĂRĂ a scrie în DB.
   * Folosit exclusiv în dry-run preview.
   */
  async peekNext(): Promise<number> {
    const productRows = await this.db
      .select({ n: schema.products.stockCode })
      .from(schema.products)
      .where(sql`${schema.products.stockCode} BETWEEN 1 AND ${MAX_STOCK_CODE}`);

    const listingRows = await this.db.execute<{ n: number | null }>(sql`
      SELECT DISTINCT (sync_state->>'emag_offer_id')::int AS n
      FROM listings
      WHERE sync_state->>'emag_offer_id' ~ '^[0-9]+$'
        AND (sync_state->>'emag_offer_id')::bigint BETWEEN 1 AND ${MAX_STOCK_CODE}
    `);

    const usedCodes = [
      ...productRows.map((r) => r.n),
      ...listingRows.map((r) => (r.n !== null ? Number(r.n) : null)),
    ].filter((n): n is number => n !== null);

    return firstFreeInRange(usedCodes);
  }
}

/**
 * Găsește primul număr întreg ≥ 1 care NU se află în lista de coduri folosite.
 * Sortează și parcurge: dacă `sorted[i] === expected`, avansăm; la prima deviere
 * (gap), returnăm `expected`.
 */
function firstFreeInRange(usedCodes: number[]): number {
  const sorted = [...new Set(usedCodes)].sort((a, b) => a - b);
  let next = 1;
  for (const code of sorted) {
    if (code === next) next++;
    else break;
  }
  if (next > MAX_STOCK_CODE) {
    throw new Error(`Stock code range 1..${MAX_STOCK_CODE} exhausted`);
  }
  return next;
}
