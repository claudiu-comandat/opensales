import { Module } from '@nestjs/common';

import { PluginsModule } from '../plugins/plugins.module.js';

import { AwbController } from './awb.controller.js';
import { AwbService } from './awb.service.js';

// TODO(T2.10): add AwbGatewayHandlers once PermissionGatewayService is available
@Module({
  imports: [PluginsModule],
  controllers: [AwbController],
  providers: [AwbService],
  exports: [AwbService],
})
export class AwbModule {}
