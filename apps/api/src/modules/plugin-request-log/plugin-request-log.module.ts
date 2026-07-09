import { Global, Module } from '@nestjs/common';

import { PluginRequestLogService } from './plugin-request-log.service.js';

@Global()
@Module({
  providers: [PluginRequestLogService],
  exports: [PluginRequestLogService],
})
export class PluginRequestLogModule {}
