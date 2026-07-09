import { Module } from '@nestjs/common';

import { CurrencyService } from './currency.service.js';

@Module({
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}
