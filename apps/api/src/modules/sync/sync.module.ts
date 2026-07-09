import { Module } from '@nestjs/common';

import { JobQueueModule } from '../../jobs/job-queue.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';

import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { PollAwbStatusWorker } from './workers/poll-awb-status.worker.js';
import { SyncListingsWorker } from './workers/sync-listings.worker.js';
import { SyncOrdersWorker } from './workers/sync-orders.worker.js';

@Module({
  imports: [JobQueueModule, PluginsModule, OrdersModule],
  controllers: [SyncController],
  providers: [SyncService, SyncOrdersWorker, SyncListingsWorker, PollAwbStatusWorker],
  exports: [SyncService],
})
export class SyncModule {}
