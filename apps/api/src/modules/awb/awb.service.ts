import { Inject, Injectable } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { eq } from 'drizzle-orm';

import type { Database } from '@opensales/db';

import { DomainError } from '../../errors/domain.error.js';
import { PluginEventsBus } from '../plugins/events/plugin-events.bus.js';

import type { AwbDto } from './dto/awb.dto.js';

export type AwbDirection = 'outgoing' | 'return';

@Injectable()
export class AwbService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly events: PluginEventsBus,
  ) {}

  async set(orderId: string, direction: AwbDirection, dto: AwbDto): Promise<schema.OrderAwb> {
    const value: schema.OrderAwb = {
      number: dto.number,
      tracking: dto.tracking,
      carrier_plugin_id: dto.carrierPluginId,
      pdf_url: dto.pdfUrl,
      status: dto.status,
      issued_at: dto.issuedAt.toISOString(),
      ...(dto.emagId !== undefined && { emag_id: dto.emagId }),
    };

    let rows: schema.Order[];
    if (direction === 'outgoing') {
      rows = await this.db
        .update(schema.orders)
        .set({ awbOutgoing: value, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning();
    } else {
      rows = await this.db
        .update(schema.orders)
        .set({ awbReturn: value, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning();
    }

    if (rows.length === 0) throw DomainError.notFound(`Order not found: ${orderId}`);
    if (dto.status === 'issued') {
      const eventName = direction === 'outgoing' ? 'awb.outgoing.issued' : 'awb.return.issued';
      this.events.emitFromPlatform(eventName, { orderId, awb: value });
    }
    return value;
  }

  async read(
    orderId: string,
  ): Promise<{ outgoing: schema.OrderAwb | null; return: schema.OrderAwb | null }> {
    const order = await this.db.query.orders.findFirst({
      where: eq(schema.orders.id, orderId),
    });
    if (!order) throw DomainError.notFound(`Order not found: ${orderId}`);
    return { outgoing: order.awbOutgoing, return: order.awbReturn };
  }

  async clear(orderId: string, direction: AwbDirection): Promise<void> {
    let rows: { id: string }[];
    if (direction === 'outgoing') {
      rows = await this.db
        .update(schema.orders)
        .set({ awbOutgoing: null, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning({ id: schema.orders.id });
    } else {
      rows = await this.db
        .update(schema.orders)
        .set({ awbReturn: null, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId))
        .returning({ id: schema.orders.id });
    }
    if (rows.length === 0) throw DomainError.notFound(`Order not found: ${orderId}`);
  }
}
