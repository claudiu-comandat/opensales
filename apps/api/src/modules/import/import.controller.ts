import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiCookieAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';

import {
  EasysalesImportService,
  type EasysalesImportResult,
  type EasysalesPrepareResult,
} from './easysales-import.service.js';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface UploadedFiles {
  products?: UploadedFile[];
  offers?: UploadedFile[];
}

interface CommitBody {
  sessionId: string;
  currency?: string;
}

@ApiTags('Import')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('import')
export class ImportController {
  constructor(private readonly easysales: EasysalesImportService) {}

  /**
   * POST /import/easysales/prepare
   *
   * Phase 1 of the two-phase import. Accepts the XLSX files, parses them
   * server-side and stages the rows in memory. Returns a sessionId.
   * No DB writes happen here — call /commit to finalise.
   */
  @Post('easysales/prepare')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'products', maxCount: 1 },
        { name: 'offers', maxCount: 10 },
      ],
      { limits: { fileSize: 50 * 1024 * 1024 } },
    ),
  )
  prepareEasysales(@UploadedFiles() rawFiles: unknown): EasysalesPrepareResult {
    const files = rawFiles as UploadedFiles | undefined;
    if (!files?.products?.[0]) {
      throw new BadRequestException('Fișierul de produse este obligatoriu (câmp: products).');
    }
    const productsBuffer = files.products[0].buffer;
    const offersBuffers = (files.offers ?? []).map((f) => f.buffer);
    return this.easysales.prepareImport(productsBuffer, offersBuffers);
  }

  /**
   * POST /import/easysales/commit
   *
   * Phase 2 of the two-phase import. Retrieves the rows staged by /prepare
   * and writes them to the database. The session is consumed and deleted.
   */
  @Post('easysales/commit')
  @HttpCode(200)
  @Roles('admin', 'operator')
  async commitEasysales(@Body() body: CommitBody): Promise<EasysalesImportResult> {
    if (!body.sessionId) {
      throw new BadRequestException('sessionId este obligatoriu.');
    }
    return this.easysales.commitImport(body.sessionId, {
      currency: body.currency ?? 'RON',
    });
  }

  /**
   * POST /import/easysales
   *
   * Classic one-shot import (kept for direct API / automated usage).
   * Accepts a multipart/form-data body with:
   *  - products  (required): the EasySales Products export (.xlsx)
   *  - offers    (optional, up to 10): EasySales Offers export files (.xlsx)
   *
   * Query params:
   *  - currency: ISO 4217 code for product prices (default: RON)
   */
  @Post('easysales')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'products', maxCount: 1 },
        { name: 'offers', maxCount: 10 },
      ],
      { limits: { fileSize: 50 * 1024 * 1024 } },
    ),
  )
  async importEasysales(
    @UploadedFiles() rawFiles: unknown,
    @Query('currency') currency = 'RON',
  ): Promise<EasysalesImportResult> {
    const files = rawFiles as UploadedFiles | undefined;
    if (!files?.products?.[0]) {
      throw new BadRequestException('Fișierul de produse este obligatoriu (câmp: products).');
    }
    const productsBuffer = files.products[0].buffer;
    const offersBuffers = (files.offers ?? []).map((f) => f.buffer);
    return this.easysales.processImport(productsBuffer, offersBuffers, { currency });
  }
}
