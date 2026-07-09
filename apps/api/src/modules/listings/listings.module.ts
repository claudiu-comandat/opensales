import { Module } from '@nestjs/common';

import { PluginsModule } from '../plugins/plugins.module.js';

import { ListingsController } from './listings.controller.js';
import { ListingsService } from './listings.service.js';

// TODO(T2.10): add ListingsGatewayHandlers once PermissionGatewayService is available
@Module({
  imports: [PluginsModule],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
