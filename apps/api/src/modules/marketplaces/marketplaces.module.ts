import { Module } from '@nestjs/common';

import { MarketplaceEnablementService } from './marketplace-enablement.service.js';

@Module({
  providers: [MarketplaceEnablementService],
  exports: [MarketplaceEnablementService],
})
export class MarketplacesModule {}
