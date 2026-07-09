import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module.js';
import { SyncModule } from '../sync/sync.module.js';

import { EmagWebhookController } from './emag-webhook.controller.js';

@Module({
  imports: [OrdersModule, SyncModule],
  controllers: [EmagWebhookController],
})
export class WebhooksModule {}
