import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';

import { TrendyolClaimsService } from './trendyol-claims.service.js';

/**
 * Endpoint-uri pentru rezolvarea retururilor de pe marketplace-uri. Consumate de n8n
 * (webhook-urile `retur-*-trendyol-*`), care la rândul lui e apelat din storage-apk.
 * Rezolvarea claim-urilor Trendyol se face aici; înregistrarea financiară a returului
 * (stoc + storno) trece prin `POST /orders/:id/return`.
 */
@ApiTags('Returns')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('returns')
export class ReturnsController {
  constructor(private readonly trendyolClaims: TrendyolClaimsService) {}

  @Get('trendyol/claims')
  @Roles('admin', 'operator')
  @Scopes('orders:read')
  async listClaims(): Promise<unknown> {
    // Formă plată (claimId, awbs, claimLineItemIdList, items[{barcode, quantity}]) — vezi mapper.
    return this.trendyolClaims.listClaims();
  }

  @Get('trendyol/claim-reasons')
  @Roles('admin', 'operator')
  @Scopes('orders:read')
  async listReasons(): Promise<unknown> {
    return this.trendyolClaims.listReasons();
  }

  @Post('trendyol/claims/:claimId/approve')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async approve(@Param('claimId') claimId: string, @Body() body: unknown): Promise<unknown> {
    const { claimLineItemIdList } = z
      .object({ claimLineItemIdList: z.array(z.string().min(1)).min(1) })
      .parse(body);
    return this.trendyolClaims.approve(claimId, claimLineItemIdList);
  }

  @Post('trendyol/claims/:claimId/reject')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async reject(@Param('claimId') claimId: string, @Body() body: unknown): Promise<unknown> {
    const input = z
      .object({
        claimItemIdList: z.array(z.string().min(1)).min(1),
        claimIssueReasonId: z.number().int(),
        description: z.string().min(1).max(500),
        imageBase64: z.string().optional(),
      })
      .parse(body);
    return this.trendyolClaims.reject({ claimId, ...input });
  }
}
