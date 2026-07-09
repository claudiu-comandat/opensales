import { Inject, Injectable } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { sql } from 'drizzle-orm';

import type { Database } from '@opensales/db';

import { DomainError } from '../../errors/domain.error.js';
import { PluginEventsBus } from '../plugins/events/plugin-events.bus.js';

import { InsufficientStockError } from './insufficient-stock.error.js';

import type { StockChangeReason } from '../events/platform-events.payloads.js';

export interface StockChange {
  productId: string;
  quantityBefore: number;
  quantityAfter: number;
}

interface UpdateRow {
  id: string;
  before: number;
  after: number;
}

@Injectable()
export class StockService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly events: PluginEventsBus,
  ) {}

  /**
   * Atomic decrement within a transaction.
   * Throws InsufficientStockError if any item lacks sufficient stock.
   */
  async decrement(
    items: { productId: string; quantity: number }[],
    reason: StockChangeReason = 'manual',
  ): Promise<StockChange[]> {
    if (items.length === 0) return [];
    const changes = await this.db.transaction(async (tx) => {
      const result: StockChange[] = [];
      for (const item of items) {
        if (item.quantity <= 0) {
          throw DomainError.validation(
            `Invalid quantity ${item.quantity} for product ${item.productId}`,
          );
        }
        const queryResult = await tx.execute(
          sql`UPDATE products
              SET stock_quantity = stock_quantity - ${item.quantity},
                  updated_at = now()
              WHERE id = ${item.productId} AND stock_quantity >= ${item.quantity}
              RETURNING id,
                        stock_quantity + ${item.quantity} AS before,
                        stock_quantity AS after`,
        );
        const rows = queryResult as unknown as UpdateRow[];
        const row = rows[0];
        if (!row) {
          const probe = await tx
            .select({ stock: schema.products.stockQuantity })
            .from(schema.products)
            .where(sql`${schema.products.id} = ${item.productId}`)
            .limit(1);
          if (probe.length === 0) {
            throw DomainError.notFound(`Product not found: ${item.productId}`);
          }
          throw new InsufficientStockError(item.productId, item.quantity, probe[0]?.stock ?? 0);
        }
        result.push({
          productId: row.id,
          quantityBefore: Number(row.before),
          quantityAfter: Number(row.after),
        });
      }
      return result;
    });
    for (const change of changes) {
      this.events.emitFromPlatform('stock.changed', { ...change, reason });
    }
    return changes;
  }

  async increment(
    items: { productId: string; quantity: number }[],
    reason: StockChangeReason = 'manual',
  ): Promise<StockChange[]> {
    if (items.length === 0) return [];
    const changes = await this.db.transaction(async (tx) => {
      const result: StockChange[] = [];
      for (const item of items) {
        if (item.quantity <= 0) {
          throw DomainError.validation(`Invalid quantity ${item.quantity}`);
        }
        const queryResult = await tx.execute(
          sql`UPDATE products
              SET stock_quantity = stock_quantity + ${item.quantity},
                  updated_at = now()
              WHERE id = ${item.productId}
              RETURNING id,
                        stock_quantity - ${item.quantity} AS before,
                        stock_quantity AS after`,
        );
        const rows = queryResult as unknown as UpdateRow[];
        const row = rows[0];
        if (!row) throw DomainError.notFound(`Product not found: ${item.productId}`);
        result.push({
          productId: row.id,
          quantityBefore: Number(row.before),
          quantityAfter: Number(row.after),
        });
      }
      return result;
    });
    for (const change of changes) {
      this.events.emitFromPlatform('stock.changed', { ...change, reason });
    }
    return changes;
  }

  // ponytail: quantityBefore/After sunt 0 — fanout listener folosește doar productId
  async reserve(items: { productId: string; quantity: number }[]): Promise<void> {
    for (const { productId, quantity } of items) {
      await this.db.execute(
        sql`UPDATE products SET stock_reserved = stock_reserved + ${quantity}, updated_at = now() WHERE id = ${productId}`,
      );
      this.events.emitFromPlatform('stock.changed', {
        productId,
        quantityBefore: 0,
        quantityAfter: 0,
        reason: 'order',
      });
    }
  }

  async releaseReservation(items: { productId: string; quantity: number }[]): Promise<void> {
    for (const { productId, quantity } of items) {
      await this.db.execute(
        sql`UPDATE products SET stock_reserved = GREATEST(0, stock_reserved - ${quantity}), updated_at = now() WHERE id = ${productId}`,
      );
      this.events.emitFromPlatform('stock.changed', {
        productId,
        quantityBefore: 0,
        quantityAfter: 0,
        reason: 'cancel',
      });
    }
  }

  async adjust(
    productId: string,
    delta: number,
    reason: StockChangeReason = 'manual',
  ): Promise<StockChange> {
    if (delta === 0) {
      throw DomainError.validation('delta must be non-zero');
    }
    if (delta > 0) {
      const changes = await this.increment([{ productId, quantity: delta }], reason);
      const c = changes[0];
      if (!c) throw DomainError.validation('Increment returned no change');
      return c;
    }
    const changes = await this.decrement([{ productId, quantity: -delta }], reason);
    const c = changes[0];
    if (!c) throw DomainError.validation('Decrement returned no change');
    return c;
  }
}
