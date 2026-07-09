import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Scopes } from '../auth/decorators/scopes.decorator.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import { TemuCatalogService } from './temu-catalog.service.js';

const brandTrademarksQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(100),
});

const complianceContactsQuery = z.object({
  /** 2 = responsabil EU, 3 = producător. */
  type: z.coerce.number().pipe(z.union([z.literal(2), z.literal(3)])),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(20).default(20),
  search: z.string().min(1).optional(),
});

const categoryAttributesQuery = z.object({
  catId: z.coerce.number().int(),
});

const extraTemplateQuery = z.object({
  catId: z.coerce.number().int(),
  goodsId: z.coerce.number().int().optional(),
});

/**
 * Endpoint-uri read-only care expun listele de referință Temu către n8n (bearer + scope,
 * ca /products/eans). n8n le paginează, le stochează în `catalogs.*` și face matching-ul.
 */
@ApiTags('Temu Catalog')
@ApiBearerAuth('apiKey')
@Controller('temu')
export class TemuCatalogController {
  constructor(private readonly service: TemuCatalogService) {}

  @Get('brand-trademarks')
  @Scopes('listings:read')
  async brandTrademarks(
    @Query(zodPipe(brandTrademarksQuery)) q: z.infer<typeof brandTrademarksQuery>,
  ): Promise<Record<string, unknown>> {
    return this.service.brandTrademarks(q.page, q.size);
  }

  @Get('compliance-contacts')
  @Scopes('listings:read')
  async complianceContacts(
    @Query(zodPipe(complianceContactsQuery)) q: z.infer<typeof complianceContactsQuery>,
  ): Promise<Record<string, unknown>> {
    return this.service.complianceContacts(q.type, q.page, q.size, q.search);
  }

  @Get('category-attributes')
  @Scopes('listings:read')
  async categoryAttributes(
    @Query(zodPipe(categoryAttributesQuery)) q: z.infer<typeof categoryAttributesQuery>,
  ): Promise<Record<string, unknown>> {
    return this.service.categoryAttributes(q.catId);
  }

  @Get('extra-template')
  @Scopes('listings:read')
  async extraTemplate(
    @Query(zodPipe(extraTemplateQuery)) q: z.infer<typeof extraTemplateQuery>,
  ): Promise<Record<string, unknown>> {
    return this.service.extraTemplate(q.catId, q.goodsId);
  }
}
