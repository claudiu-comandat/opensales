import { Module } from '@nestjs/common';

import { ListingsModule } from '../listings/listings.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';

import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { StockCodeService } from './stock-code.service.js';

// TODO(T2.10): add ProductsGatewayHandlers once PermissionGatewayService is available
@Module({
  imports: [PluginsModule, ListingsModule],
  controllers: [ProductsController],
  providers: [ProductsService, StockCodeService],
  exports: [ProductsService, StockCodeService],
})
export class ProductsModule {}
