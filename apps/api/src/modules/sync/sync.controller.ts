import { Controller, HttpCode, Param, Post } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';

import { SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Post('orders/:pluginId')
  @HttpCode(202)
  @Roles('admin', 'operator')
  async orders(@Param('pluginId') pluginId: string): Promise<{ jobId: string | null }> {
    const jobId = await this.service.enqueueOrders(pluginId);
    return { jobId };
  }

  @Post('listings/:pluginId')
  @HttpCode(202)
  @Roles('admin', 'operator')
  async listings(@Param('pluginId') pluginId: string): Promise<{ jobId: string | null }> {
    const jobId = await this.service.enqueueListings(pluginId);
    return { jobId };
  }
}
