import { Module } from '@nestjs/common';

import { JobQueueModule } from '../../jobs/job-queue.module.js';
import { CurrencyModule } from '../currency/currency.module.js';
import { ListingsModule } from '../listings/listings.module.js';
import { MarketplacesModule } from '../marketplaces/marketplaces.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { ProductsModule } from '../products/products.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { EasysalesImportService } from './easysales-import.service.js';
import { EmagImportController } from './emag-import.controller.js';
import { EmagImportService } from './emag-import.service.js';
import { ImportBatchService } from './import-batch.service.js';
import { ImportController } from './import.controller.js';
import { OfferPriceController } from './offer-price.controller.js';
import { OfferPriceService } from './offer-price.service.js';
import { PushImportController } from './push-import.controller.js';
import { PushImportService } from './push-import.service.js';
import { StockFanoutListener } from './stock-fanout.listener.js';
import { TemuImportController } from './temu-import.controller.js';
import { TemuImportService } from './temu-import.service.js';
import { TrendyolImportController } from './trendyol-import.controller.js';
import { TrendyolImportService } from './trendyol-import.service.js';
import { TrendyolInventorySyncService } from './trendyol-inventory-sync.service.js';
import { ActivateOfferWorker } from './workers/activate-offer.worker.js';
import { EmagAssociateWorker } from './workers/emag-associate.worker.js';
import { EmagReconcileWorker } from './workers/emag-reconcile.worker.js';
import { ImportBatchWorker } from './workers/import-batch.worker.js';
import { PriceUpdateWorker } from './workers/price-update.worker.js';
import { PushOfferWorker } from './workers/push-offer.worker.js';
import { TrendyolReconcileWorker } from './workers/trendyol-reconcile.worker.js';
import { UpdateProductContentWorker } from './workers/update-product-content.worker.js';
import { UpdateStockWorker } from './workers/update-stock.worker.js';

@Module({
  imports: [
    JobQueueModule,
    PluginsModule,
    ProductsModule,
    ListingsModule,
    MarketplacesModule,
    CurrencyModule,
    WorkspaceModule,
  ],
  controllers: [
    ImportController,
    EmagImportController,
    TemuImportController,
    TrendyolImportController,
    PushImportController,
    OfferPriceController,
  ],
  providers: [
    EasysalesImportService,
    EmagImportService,
    TemuImportService,
    TrendyolImportService,
    PushImportService,
    ImportBatchService,
    OfferPriceService,
    TrendyolInventorySyncService,
    PushOfferWorker,
    EmagReconcileWorker,
    EmagAssociateWorker,
    TrendyolReconcileWorker,
    UpdateStockWorker,
    UpdateProductContentWorker,
    PriceUpdateWorker,
    ActivateOfferWorker,
    ImportBatchWorker,
    StockFanoutListener,
  ],
  exports: [EmagImportService, TrendyolImportService, TemuImportService],
})
export class ImportModule {}
