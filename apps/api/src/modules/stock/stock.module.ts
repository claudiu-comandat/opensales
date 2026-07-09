import { Module } from '@nestjs/common';

import { PluginsModule } from '../plugins/plugins.module.js';

import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

// TODO(T2.10): add StockGatewayHandlers once PermissionGatewayService is available
@Module({
  imports: [PluginsModule],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
