import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import { JobQueueService } from '../../jobs/job-queue.service.js';
import { PluginEventsBus } from '../plugins/events/plugin-events.bus.js';

import { UPDATE_STOCK_JOB, type UpdateStockJob } from './push-jobs.js';

const stockChangedSchema = z.object({ productId: z.string().min(1) });

/**
 * Ascultă evenimentul platformă `stock.changed` (emis de StockService la
 * modificări manuale ȘI de InvoiceService/OrdersService la factură/storno) și
 * enqueue-uiește un `UPDATE_STOCK_JOB` ca noul stoc să se propage pe toate
 * marketplace-urile pe care e listat produsul. Fără acest listener, schimbările
 * de stoc din afara importului nu ajungeau niciodată la marketplace-uri.
 */
@Injectable()
export class StockFanoutListener implements OnApplicationBootstrap {
  constructor(
    private readonly events: PluginEventsBus,
    private readonly queue: JobQueueService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.events.onPlatform('stock.changed', (payload) => this.handle(payload));
  }

  async handle(payload: unknown): Promise<void> {
    const parsed = stockChangedSchema.safeParse(payload);
    if (!parsed.success) return;
    await this.queue.enqueue<UpdateStockJob>(UPDATE_STOCK_JOB, {
      productId: parsed.data.productId,
    });
  }
}
