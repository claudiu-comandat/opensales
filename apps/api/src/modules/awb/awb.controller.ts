import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import { AwbService } from './awb.service.js';
import { awbSchema, type AwbDto } from './dto/awb.dto.js';

@Controller('orders/:orderId')
export class AwbController {
  constructor(private readonly service: AwbService) {}

  @Get('awb')
  @Roles('admin', 'operator')
  @Scopes('orders:read')
  getAwb(@Param('orderId') orderId: string) {
    return this.service.read(orderId);
  }

  @Put('awb-outgoing')
  @Roles('admin', 'operator')
  @Scopes('awb:emit')
  setOutgoing(@Param('orderId') orderId: string, @Body(zodPipe(awbSchema)) body: AwbDto) {
    return this.service.set(orderId, 'outgoing', body);
  }

  @Put('awb-return')
  @Roles('admin', 'operator')
  @Scopes('awb:emit')
  setReturn(@Param('orderId') orderId: string, @Body(zodPipe(awbSchema)) body: AwbDto) {
    return this.service.set(orderId, 'return', body);
  }

  @Delete('awb-outgoing')
  @HttpCode(204)
  @Roles('admin', 'operator')
  @Scopes('awb:emit')
  async clearOutgoing(@Param('orderId') orderId: string): Promise<void> {
    await this.service.clear(orderId, 'outgoing');
  }

  @Delete('awb-return')
  @HttpCode(204)
  @Roles('admin', 'operator')
  @Scopes('awb:emit')
  async clearReturn(@Param('orderId') orderId: string): Promise<void> {
    await this.service.clear(orderId, 'return');
  }
}
