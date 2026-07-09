import { Inject, Injectable } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { and, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';

import type { Database } from '@opensales/db';

import { DomainError } from '../../errors/domain.error.js';
import { PluginEventsBus } from '../plugins/events/plugin-events.bus.js';
import { StockService } from '../stock/stock.service.js';

import type { InvoiceDto } from './dto/invoice.dto.js';

export type InvoiceKind = 'invoice' | 'storno';

@Injectable()
export class InvoiceService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly events: PluginEventsBus,
    private readonly stock: StockService,
  ) {}

  async set(orderId: string, kind: InvoiceKind, dto: InvoiceDto): Promise<schema.OrderInvoice> {
    const value: schema.OrderInvoice = {
      series: dto.series,
      number: dto.number,
      pdf_url: dto.pdfUrl,
      status: dto.status,
      issued_at: dto.issuedAt.toISOString(),
    };

    const [current] = await this.db
      .select({ invoice: schema.orders.invoice, storno: schema.orders.invoiceStorno })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (!current) throw DomainError.notFound(`Order not found: ${orderId}`);

    // Nu putem emite factură când există produse neidentificate în comandă
    if (kind === 'invoice') {
      const [unmatchedCount] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.orderItems)
        .where(
          and(
            eq(schema.orderItems.orderId, orderId),
            isNull(schema.orderItems.productId),
            notInArray(schema.orderItems.sku, ['TRANSPORT', 'VOUCHER']),
          ),
        );
      if ((unmatchedCount?.count ?? 0) > 0) {
        throw DomainError.conflict(
          `Cannot emit invoice for order ${orderId}: ${unmatchedCount?.count ?? 1} item(s) are not matched to products. Use Manual Matching first.`,
        );
      }
    }

    if (kind === 'invoice' && current.invoice !== null) {
      const existing = current.invoice;
      throw DomainError.conflict(
        `Order ${orderId} already has an invoice (${existing.series}-${existing.number})`,
      );
    }
    if (kind === 'storno') {
      if (current.invoice === null) {
        throw DomainError.conflict(`Cannot issue storno for order ${orderId}: no original invoice`);
      }
      if (current.storno !== null) {
        const existing = current.storno;
        throw DomainError.conflict(
          `Order ${orderId} already has a storno (${existing.series}-${existing.number})`,
        );
      }
    }

    let rows: schema.Order[];
    if (kind === 'invoice') {
      rows = await this.db
        .update(schema.orders)
        .set({ invoice: value, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning();
    } else {
      rows = await this.db
        .update(schema.orders)
        .set({ invoiceStorno: value, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning();
    }

    if (rows.length === 0) throw DomainError.notFound(`Order not found: ${orderId}`);

    if (dto.status === 'issued') {
      const eventName = kind === 'invoice' ? 'invoice.issued' : 'invoice.storno.issued';
      this.events.emitFromPlatform(eventName, { orderId, invoice: value });

      const stockItems = await this.loadStockItems(orderId);
      if (stockItems.length > 0) {
        if (kind === 'invoice') {
          await this.stock.releaseReservation(stockItems);
          await this.db
            .update(schema.orders)
            .set({ stockReservationClaimed: false })
            .where(eq(schema.orders.id, orderId));
          await this.stock.decrement(stockItems, 'order');
        } else {
          await this.stock.increment(stockItems, 'cancel');
        }
      }
    }

    return value;
  }

  async clear(orderId: string, kind: InvoiceKind): Promise<void> {
    const [current] = await this.db
      .select({ invoice: schema.orders.invoice, storno: schema.orders.invoiceStorno })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (!current) throw DomainError.notFound(`Order not found: ${orderId}`);

    if (kind === 'invoice' && current.storno !== null) {
      const s = current.storno;
      throw DomainError.conflict(
        `Cannot delete invoice for order ${orderId}: storno (${s.series}-${s.number}) exists. Delete storno first.`,
      );
    }

    let rows: { id: string }[];
    if (kind === 'invoice') {
      rows = await this.db
        .update(schema.orders)
        .set({ invoice: null, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning({ id: schema.orders.id });
    } else {
      rows = await this.db
        .update(schema.orders)
        .set({ invoiceStorno: null, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning({ id: schema.orders.id });
    }

    if (rows.length === 0) throw DomainError.notFound(`Order not found: ${orderId}`);

    const wasIssued =
      kind === 'invoice'
        ? current.invoice?.status === 'issued'
        : current.storno?.status === 'issued';

    if (wasIssued) {
      const stockItems = await this.loadStockItems(orderId);
      if (stockItems.length > 0) {
        if (kind === 'invoice') {
          await this.stock.increment(stockItems, 'cancel');
          await this.stock.reserve(stockItems);
          await this.db
            .update(schema.orders)
            .set({ stockReservationClaimed: true })
            .where(eq(schema.orders.id, orderId));
        } else {
          await this.stock.decrement(stockItems, 'order');
        }
      }
    }
  }

  private async loadStockItems(
    orderId: string,
  ): Promise<{ productId: string; quantity: number }[]> {
    const rows = await this.db
      .select({ productId: schema.orderItems.productId, quantity: schema.orderItems.quantity })
      .from(schema.orderItems)
      .where(and(eq(schema.orderItems.orderId, orderId), isNotNull(schema.orderItems.productId)));

    return rows.filter((r): r is { productId: string; quantity: number } => r.productId !== null);
  }
}
