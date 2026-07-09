import { Global, Module } from '@nestjs/common';

import { MasterKeyService } from './master-key.service.js';

@Global()
@Module({
  providers: [MasterKeyService],
  exports: [MasterKeyService],
})
export class PlatformModule {}
