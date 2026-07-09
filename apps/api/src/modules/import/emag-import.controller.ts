import { Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';

import { EmagImportService } from './emag-import.service.js';
import { EmagReconcileWorker } from './workers/emag-reconcile.worker.js';

import type { EmagImportProgress } from './emag-import.types.js';

@ApiTags('Import')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('import/emag')
export class EmagImportController {
  constructor(
    private readonly emag: EmagImportService,
    private readonly reconcile: EmagReconcileWorker,
  ) {}

  /**
   * POST /import/emag/start
   *
   * Verifies the eMAG plugin is installed and active, enqueues a background
   * job that paginates through `syncOffers` and upserts products + listings.
   * Returns the jobId immediately; poll `/status/:jobId` for progress.
   */
  @Post('start')
  @HttpCode(202)
  @Roles('admin', 'operator')
  async start(): Promise<{ jobId: string; totalProducts: number; totalPages: number }> {
    return this.emag.startImport();
  }

  /**
   * GET /import/emag/status/:jobId
   *
   * Reads the in-memory progress entry for a job. Entries live for 1 hour
   * after the last update; older jobs respond with 404.
   */
  /**
   * POST /import/emag/sync-validation
   *
   * Enqueues an immediate validation-status reconcile job (normally runs every 2h).
   */
  @Post('sync-validation')
  @HttpCode(202)
  @Roles('admin', 'operator')
  async syncValidation(): Promise<{ ok: boolean; pluginId: string | null }> {
    return this.reconcile.trigger();
  }

  @Get('status/:jobId')
  @Roles('admin', 'operator')
  getStatus(@Param('jobId') jobId: string): EmagImportProgress {
    const progress = this.emag.getStatus(jobId);
    if (!progress) {
      throw new NotFoundException(`Job de import necunoscut sau expirat: ${jobId}`);
    }
    return progress;
  }
}
