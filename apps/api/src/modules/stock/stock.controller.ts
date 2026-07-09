import { Body, Controller, Post } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import { adjustStockSchema } from './dto/adjust-stock.dto.js';
import { StockService } from './stock.service.js';

import type { AdjustStockDto } from './dto/adjust-stock.dto.js';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('adjust')
  @Roles('admin', 'operator')
  @Scopes('stock:write')
  async adjust(
    @Body(zodPipe(adjustStockSchema)) body: AdjustStockDto,
  ): Promise<{ productId: string; quantityAfter: number }> {
    const change = await this.stock.adjust(body.productId, body.delta);
    return { productId: change.productId, quantityAfter: change.quantityAfter };
  }
}
