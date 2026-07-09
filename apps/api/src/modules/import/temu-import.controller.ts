import { Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';

import { TemuImportService } from './temu-import.service.js';

import type { TemuImportProgress } from './temu-import.types.js';

@ApiTags('Import')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('import/temu')
export class TemuImportController {
  constructor(private readonly temu: TemuImportService) {}

  /**
   * POST /import/temu/start
   *
   * Verifies the Temu plugin is installed and active, enqueues a background
   * job that paginates through `syncGoods` and upserts products + listings.
   * Returns the jobId immediately; poll `/status/:jobId` for progress.
   */
  @Post('start')
  @HttpCode(202)
  @Roles('admin', 'operator')
  async start(): Promise<{ jobId: string; totalProducts: number; totalPages: number }> {
    return this.temu.startImport();
  }

  /**
   * GET /import/temu/status/:jobId
   *
   * Reads the in-memory progress entry for a job. Entries live for 1 hour
   * after the last update; older jobs respond with 404.
   */
  @Get('status/:jobId')
  @Roles('admin', 'operator')
  getStatus(@Param('jobId') jobId: string): TemuImportProgress {
    const progress = this.temu.getStatus(jobId);
    if (!progress) {
      throw new NotFoundException(`Job de import necunoscut sau expirat: ${jobId}`);
    }
    return progress;
  }
}
