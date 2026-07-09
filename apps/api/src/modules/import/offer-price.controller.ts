import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import { OfferPriceService } from './offer-price.service.js';

const setPriceSchema = z.object({
  /** Preț nou în RON, minor units (ex. "35700" = 357.00 RON). */
  amountMinor: z.string().regex(/^\d+$/, 'amountMinor must be minor units (digits only)'),
});
type SetPriceDto = z.infer<typeof setPriceSchema>;

@ApiTags('Products')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('products')
export class OfferPriceController {
  constructor(private readonly service: OfferPriceService) {}

  /** Setează prețul pe toate ofertele produsului (RON minor units). */
  @Post(':id/price')
  @Roles('admin', 'operator')
  @Scopes('listings:write')
  async setPrice(
    @Param('id') id: string,
    @Body(zodPipe(setPriceSchema)) body: SetPriceDto,
  ): Promise<{ updated: number }> {
    return this.service.setPriceForProduct(id, BigInt(body.amountMinor));
  }
}
