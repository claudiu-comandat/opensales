import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';

import { BulkUpdateProductDto, bulkUpdateProductSchema } from './dto/bulk-update-product.dto.js';
import { CreateProductDto, createProductSchema } from './dto/create-product.dto.js';
import { ListProductsDto, listProductsSchema } from './dto/list-products.dto.js';
import { toResponse } from './dto/product-response.dto.js';
import { StockSyncDto, stockSyncSchema } from './dto/stock-sync.dto.js';
import { UpdateProductDto, updateProductSchema } from './dto/update-product.dto.js';
import { zodPipe } from './pipes/zod-validation.pipe.js';
import { ProductsService } from './products.service.js';

import type { ProductResponse } from './dto/product-response.dto.js';
import type { ProductStats } from './products.service.js';

@ApiTags('Products')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @Scopes('products:read')
  async list(
    @Query(zodPipe(listProductsSchema)) query: ListProductsDto,
  ): Promise<{ data: ProductResponse[]; total: number; page: number; pageSize: number }> {
    const { data, total } = await this.service.list(query);
    return {
      data: data.map((p) => toResponse(p, p.listings)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  @Get('stats')
  @Scopes('products:read')
  async stats(): Promise<ProductStats> {
    return this.service.stats();
  }

  @Delete()
  @HttpCode(200)
  @Roles('admin')
  @Scopes('products:write')
  async deleteAll(): Promise<{ deleted: number }> {
    const count = await this.service.deleteAll();
    return { deleted: count };
  }

  @Get('eans')
  @Scopes('products:read')
  async listEans(): Promise<{ eans: string[] }> {
    return { eans: await this.service.listEans() };
  }

  @Get('ean-skus')
  @Scopes('products:read')
  async listEanSkus(): Promise<{ items: { ean: string; sku: string }[]; total: number }> {
    const items = await this.service.listEanSkus();
    return { items, total: items.length };
  }

  @Post('stock-sync')
  @Roles('admin', 'operator')
  @Scopes('products:write')
  async stockSync(
    @Body(zodPipe(stockSyncSchema)) body: StockSyncDto,
  ): Promise<{ updated: number; zeroed: number; skipped: number; total: number }> {
    return this.service.stockSync(body.result);
  }

  @Get(':id')
  @Scopes('products:read')
  async get(@Param('id') id: string): Promise<ProductResponse> {
    const p = await this.service.get(id);
    return toResponse(p, p.listings);
  }

  @Post()
  @Roles('admin', 'operator')
  @Scopes('products:write')
  async create(
    @Body(zodPipe(createProductSchema)) body: CreateProductDto,
  ): Promise<ProductResponse> {
    return toResponse(await this.service.create(body));
  }

  @Patch()
  @Roles('admin', 'operator')
  @Scopes('products:write')
  async updateMany(
    @Body(zodPipe(bulkUpdateProductSchema)) body: BulkUpdateProductDto,
  ): Promise<{ updated: number; notFound: string[] }> {
    return this.service.updateMany(body.products);
  }

  @Patch(':id')
  @Roles('admin', 'operator')
  @Scopes('products:write')
  async update(
    @Param('id') id: string,
    @Body(zodPipe(updateProductSchema)) body: UpdateProductDto,
  ): Promise<ProductResponse> {
    const { product, changedFields } = await this.service.update(id, body);
    return toResponse(product, [], changedFields);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('admin')
  @Scopes('products:write')
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }
}
