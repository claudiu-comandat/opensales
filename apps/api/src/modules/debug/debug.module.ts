import { Module } from '@nestjs/common';

import { JobQueueModule } from '../../jobs/job-queue.module.js';
import { ImportModule } from '../import/import.module.js';
import { ListingsModule } from '../listings/listings.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { ProductsModule } from '../products/products.module.js';

import { DebugController } from './debug.controller.js';
import { DebugService } from './debug.service.js';
import { PushDebugService } from './push-debug.service.js';

@Module({
  imports: [PluginsModule, JobQueueModule, ProductsModule, ListingsModule, ImportModule],
  controllers: [DebugController],
  providers: [DebugService, PushDebugService],
})
export class DebugModule {}
