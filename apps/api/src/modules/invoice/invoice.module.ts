import { Module } from '@nestjs/common';

import { PluginsModule } from '../plugins/plugins.module.js';
import { StockModule } from '../stock/stock.module.js';

import { InvoiceActionsService } from './invoice-actions.service.js';
import { InvoiceController } from './invoice.controller.js';
import { InvoiceService } from './invoice.service.js';

@Module({
  imports: [PluginsModule, StockModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceActionsService],
  exports: [InvoiceService, InvoiceActionsService],
})
export class InvoiceModule {}
