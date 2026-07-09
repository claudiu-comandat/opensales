import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import { ListListingsDto, listListingsSchema } from './dto/list-listings.dto.js';
import { toResponse } from './dto/listing-response.dto.js';
import { patchSyncStateSchema } from './dto/patch-sync-state.dto.js';
import { UpsertListingDto, upsertListingSchema } from './dto/upsert-listing.dto.js';
import { ListingsService } from './listings.service.js';

const setActiveSchema = z.object({ active: z.boolean() });

import type { ListingResponse } from './dto/listing-response.dto.js';
import type { PatchSyncStateDto } from './dto/patch-sync-state.dto.js';

@ApiTags('Listings')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('listings')
export class ListingsController {
  constructor(private readonly service: ListingsService) {}

  @Get()
  @Scopes('listings:read')
  async list(
    @Query(zodPipe(listListingsSchema)) q: ListListingsDto,
  ): Promise<{ data: ListingResponse[]; total: number; page: number; pageSize: number }> {
    const { data, total } = await this.service.list(q);
    return { data: data.map(toResponse), total, page: q.page, pageSize: q.pageSize };
  }

  @Get(':id')
  @Scopes('listings:read')
  async get(@Param('id') id: string): Promise<ListingResponse> {
    return toResponse(await this.service.get(id));
  }

  @Post()
  @Roles('admin', 'operator')
  @Scopes('listings:write')
  async upsert(
    @Body(zodPipe(upsertListingSchema)) body: UpsertListingDto,
  ): Promise<ListingResponse> {
    return toResponse(await this.service.upsert(body));
  }

  @Patch(':id/sync-state')
  @Roles('admin', 'operator')
  @Scopes('listings:write')
  async patchSyncState(
    @Param('id') id: string,
    @Body(zodPipe(patchSyncStateSchema)) body: PatchSyncStateDto,
  ): Promise<ListingResponse> {
    return toResponse(await this.service.mergeSyncState(id, body));
  }

  /** Retrimite manual oferta pe marketplace (re-enqueue push, reaplicând override-urile). */
  @Post(':id/repush')
  @Roles('admin', 'operator')
  @Scopes('listings:write')
  async repush(@Param('id') id: string): Promise<ListingResponse> {
    return toResponse(await this.service.repush(id));
  }

  /** Activează (repush) sau dezactivează (paused) o ofertă. */
  @Patch(':id/active')
  @Roles('admin', 'operator')
  @Scopes('listings:write')
  async setActive(
    @Param('id') id: string,
    @Body(zodPipe(setActiveSchema)) body: z.infer<typeof setActiveSchema>,
  ): Promise<ListingResponse> {
    return toResponse(await this.service.setActive(id, body.active));
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('admin', 'operator')
  @Scopes('listings:write')
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }
}
