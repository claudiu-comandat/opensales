import { Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';

import { TrendyolImportService } from './trendyol-import.service.js';

import type {
  TrendyolImportDebugReport,
  TrendyolImportProgress,
  TrendyolPreviewResult,
} from './trendyol-import.types.js';

@ApiTags('Import')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('import/trendyol')
export class TrendyolImportController {
  constructor(private readonly trendyol: TrendyolImportService) {}

  /**
   * GET /import/trendyol/preview
   *
   * Fetches the first product from Trendyol and returns the raw data, the
   * mapped fields, and whether a matching product already exists in the
   * platform. Does not modify any data.
   */
  @Get('preview')
  @Roles('admin', 'operator')
  async preview(): Promise<TrendyolPreviewResult> {
    return this.trendyol.getPreview();
  }

  /**
   * POST /import/trendyol/start
   *
   * Verifies the Trendyol plugin is installed and active, enqueues a
   * background job that paginates through `filterProducts` and upserts
   * products + listings. Returns the jobId immediately; poll `/status/:jobId`
   * for progress.
   */
  @Post('start')
  @HttpCode(202)
  @Roles('admin', 'operator')
  async start(): Promise<{ jobId: string; totalProducts: number; totalPages: number }> {
    return this.trendyol.startImport();
  }

  /**
   * GET /import/trendyol/status/:jobId
   *
   * Reads the in-memory progress entry for a job. Entries live for 1 hour
   * after the last update; older jobs respond with 404.
   */
  @Get('status/:jobId')
  @Roles('admin', 'operator')
  getStatus(@Param('jobId') jobId: string): TrendyolImportProgress {
    const progress = this.trendyol.getStatus(jobId);
    if (!progress) {
      throw new NotFoundException(`Job de import necunoscut sau expirat: ${jobId}`);
    }
    return progress;
  }

  /**
   * GET /import/trendyol/debug/:jobId
   *
   * Returns a per-item diagnostic report for an import: per-storefront outcome
   * counts (seen/imported/ignored/invalid), distinct contentIds, how many
   * contentIds appear under multiple storefronts (collapse risk), and the full
   * record list with barcode + productMainId + storefront + outcome.
   */
  @Get('debug/:jobId')
  @Roles('admin', 'operator')
  getDebug(@Param('jobId') jobId: string): TrendyolImportDebugReport {
    const report = this.trendyol.getDebug(jobId);
    if (!report) {
      throw new NotFoundException(`Job de import necunoscut sau expirat: ${jobId}`);
    }
    return report;
  }

  /**
   * POST /import/trendyol/:pluginId/push-all
   *
   * Pune în coadă un push complet al tuturor ofertelor Trendyol pentru plugin-ul
   * dat. Dacă „Easy Cross Country" e activat în config, trimite doar pe trendyol-ro;
   * altfel trimite pe toate marketplace-urile activate.
   */
  @Post(':pluginId/push-all')
  @HttpCode(200)
  @Roles('admin')
  async pushAll(@Param('pluginId') pluginId: string): Promise<{ ok: boolean; queued: number }> {
    return this.trendyol.pushAll(pluginId);
  }
}
