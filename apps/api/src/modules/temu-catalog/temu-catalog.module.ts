import { Module } from '@nestjs/common';

import { PluginsModule } from '../plugins/plugins.module.js';

import { TemuCatalogController } from './temu-catalog.controller.js';
import { TemuCatalogService } from './temu-catalog.service.js';

@Module({
  imports: [PluginsModule],
  controllers: [TemuCatalogController],
  providers: [TemuCatalogService],
})
export class TemuCatalogModule {}
