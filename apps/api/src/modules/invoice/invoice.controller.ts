import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import { invoiceSchema, type InvoiceDto } from './dto/invoice.dto.js';
import { InvoiceActionsService } from './invoice-actions.service.js';
import { InvoiceService } from './invoice.service.js';

@Controller('orders/:orderId')
export class InvoiceController {
  constructor(
    private readonly service: InvoiceService,
    private readonly actions: InvoiceActionsService,
  ) {}

  // ── quick-action endpoints (delegate to invoicing plugin) ──────────────────

  /** Emits an invoice for the order via the configured invoicing plugin. */
  @Post('invoice/emit')
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  emitInvoice(@Param('orderId') orderId: string) {
    return this.actions.emitInvoice(orderId);
  }

  /** Creates a storno (credit note) for the order's invoice via the invoicing plugin. */
  @Post('invoice/storno')
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  stornoInvoice(@Param('orderId') orderId: string) {
    return this.actions.stornoInvoice(orderId);
  }

  // ── debug / test endpoints (no DB write) ──────────────────────────────────

  @Get('invoice/preview-emit')
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  previewEmitInput(@Param('orderId') orderId: string) {
    return this.actions.previewEmitInput(orderId);
  }

  @Post('invoice/test-emit')
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  testEmitInvoice(@Param('orderId') orderId: string) {
    return this.actions.testEmitInvoice(orderId);
  }

  @Get('invoice/preview-storno')
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  previewStornoInput(@Param('orderId') orderId: string) {
    return this.actions.previewStornoInput(orderId);
  }

  @Post('invoice/test-storno')
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  testStornoInvoice(@Param('orderId') orderId: string) {
    return this.actions.testStornoInvoice(orderId);
  }

  // ── manual CRUD (raw data, no plugin call for PUT) ─────────────────────────

  @Put('invoice')
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  setInvoice(@Param('orderId') orderId: string, @Body(zodPipe(invoiceSchema)) body: InvoiceDto) {
    return this.service.set(orderId, 'invoice', body);
  }

  @Put('invoice-storno')
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  setStorno(@Param('orderId') orderId: string, @Body(zodPipe(invoiceSchema)) body: InvoiceDto) {
    return this.service.set(orderId, 'storno', body);
  }

  /**
   * Cancels the invoice at the provider (fgoCancelDirect) and clears it from
   * the platform DB.  Enforces: invoice must exist, no storno present.
   */
  @Delete('invoice')
  @HttpCode(204)
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  async deleteInvoice(@Param('orderId') orderId: string): Promise<void> {
    await this.actions.deleteInvoice(orderId);
  }

  @Delete('invoice-storno')
  @HttpCode(204)
  @Roles('admin', 'operator')
  @Scopes('invoice:emit')
  async clearStorno(@Param('orderId') orderId: string): Promise<void> {
    await this.service.clear(orderId, 'storno');
  }
}
