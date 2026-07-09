import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';

import { JobQueueService } from './job-queue.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [JobQueueService],
  exports: [JobQueueService],
})
export class JobQueueModule {}
