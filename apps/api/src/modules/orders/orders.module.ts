import { Module } from '@nestjs/common';

import { JobQueueModule } from '../../jobs/job-queue.module.js';
import { AwbModule } from '../awb/awb.module.js';
import { InvoiceModule } from '../invoice/invoice.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { StockModule } from '../stock/stock.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { EmagAwbIssueService } from './emag-awb-issue.service.js';
import { EmagAwbPdfService } from './emag-awb-pdf.service.js';
import { EmagAwbStatusService } from './emag-awb-status.service.js';
import { EmagOrderActionsService } from './emag-order-actions.service.js';
import { EmagOrderSyncService } from './emag-order-sync.service.js';
import { OrderReturnsService } from './order-returns.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersGatewayHandlers } from './orders.gateway-handlers.js';
import { OrdersService } from './orders.service.js';
import { ReturnsController } from './returns.controller.js';
import { TemuAwbService } from './temu-awb.service.js';
import { TemuOrderSyncService } from './temu-order-sync.service.js';
import { TrendyolAwbService } from './trendyol-awb.service.js';
import { TrendyolClaimsService } from './trendyol-claims.service.js';
import { TrendyolOrderActionsService } from './trendyol-order-actions.service.js';
import { TrendyolOrderSyncService } from './trendyol-order-sync.service.js';

@Module({
  imports: [PluginsModule, JobQueueModule, AwbModule, InvoiceModule, StockModule, WorkspaceModule],
  controllers: [OrdersController, ReturnsController],
  providers: [
    OrdersService,
    OrderReturnsService,
    EmagOrderSyncService,
    EmagOrderActionsService,
    EmagAwbStatusService,
    EmagAwbIssueService,
    EmagAwbPdfService,
    OrdersGatewayHandlers,
    TemuOrderSyncService,
    TemuAwbService,
    TrendyolOrderSyncService,
    TrendyolOrderActionsService,
    TrendyolClaimsService,
    TrendyolAwbService,
  ],
  exports: [
    OrdersService,
    OrderReturnsService,
    EmagOrderSyncService,
    EmagAwbStatusService,
    TemuOrderSyncService,
    TrendyolOrderSyncService,
  ],
})
export class OrdersModule {}
