import { Module } from '@nestjs/common';
import { DbModule } from '@opensales/db';

import { AppController } from './app.controller.js';
import { ConfigModule } from './config/config.module.js';
import { ConfigService } from './config/config.service.js';
import { HealthModule } from './health/health.module.js';
import { JobQueueModule } from './jobs/job-queue.module.js';
import { LoggerModule } from './logging/logger.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AwbModule } from './modules/awb/awb.module.js';
import { DebugModule } from './modules/debug/debug.module.js';
import { ImportModule } from './modules/import/import.module.js';
import { InvoiceModule } from './modules/invoice/invoice.module.js';
import { ListingsModule } from './modules/listings/listings.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { PluginRequestLogModule } from './modules/plugin-request-log/plugin-request-log.module.js';
import { PluginsModule } from './modules/plugins/plugins.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { StockModule } from './modules/stock/stock.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { TemuCatalogModule } from './modules/temu-catalog/temu-catalog.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DbModule.forRoot(new ConfigService().databaseUrl),
    PlatformModule,
    JobQueueModule,
    HealthModule,
    AuthModule,
    DebugModule,
    AwbModule,
    ImportModule,
    InvoiceModule,
    ProductsModule,
    StockModule,
    ListingsModule,
    OrdersModule,
    SyncModule,
    TemuCatalogModule,
    PluginRequestLogModule,
    PluginsModule,
    WebhooksModule,
    WorkspaceModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
