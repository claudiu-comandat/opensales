import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { PluginRequestLogService } from '../plugin-request-log/plugin-request-log.service.js';

import { DebugService } from './debug.service.js';
import {
  PushDebugService,
  type PushOfferTrace,
  type ResyncOfferResult,
} from './push-debug.service.js';

import type { DebugInfo } from './debug.service.js';
import type { RejectedListingsReport } from './rejected-listings.js';

export interface RequestLogListItem {
  id: string;
  pluginId: string;
  method: string;
  url: string;
  path: string;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  correlation: Record<string, string | number> | null;
  createdAt: string;
}

export interface RequestLogDetail extends RequestLogListItem {
  requestBody: unknown;
  requestHeaders: Record<string, string> | null;
  responseBody: unknown;
  responseSizeBytes: number | null;
}

@ApiTags('Debug')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('debug')
export class DebugController {
  constructor(
    private readonly debug: DebugService,
    private readonly requestLog: PluginRequestLogService,
    private readonly pushDebug: PushDebugService,
  ) {}

  /**
   * Testează SINCRON push-ul unei oferte către marketplace-ul ei (eMAG/Trendyol),
   * ocolind coada de job-uri. Întoarce un trace pas-cu-pas + rezultatul/eroarea
   * brută. `?dryRun=true` construiește doar payload-ul, fără apel API.
   *
   *   POST /debug/push-offer/<listingId>
   *   POST /debug/push-offer/<listingId>?dryRun=true
   */
  @Post('push-offer/:listingId')
  @Roles('admin')
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  async tracePushOffer(
    @Param('listingId') listingId: string,
    @Query('dryRun') dryRun?: string,
  ): Promise<PushOfferTrace> {
    return this.pushDebug.tracePushOffer(listingId, { dryRun: dryRun === 'true' });
  }

  /**
   * Citește starea CURENTĂ a unei oferte eMAG (titlu/poze/preț/stoc/status) și o
   * trage înapoi ca override per-ofertă — pentru modificări făcute manual direct
   * în interfața eMAG (activare/dezactivare, preț, poze) care altfel nu ar ajunge
   * niciodată în OpenSales.
   *
   *   POST /debug/resync-offer/<listingId>
   */
  @Post('resync-offer/:listingId')
  @Roles('admin')
  async resyncOffer(@Param('listingId') listingId: string): Promise<ResyncOfferResult> {
    return this.pushDebug.resyncOffer(listingId);
  }

  @Get()
  @Roles('admin')
  getDebugInfo(): Promise<DebugInfo> {
    return this.debug.getDebugInfo();
  }

  /**
   * Retrimite link-urile de factură la Trendyol pentru toate comenzile
   * cu factură emisă (status=issued, pdf_url prezent). 409 = deja atașat = skip.
   *
   *   POST /debug/trendyol-backfill-invoices
   */
  @Post('trendyol-backfill-invoices')
  @Roles('admin')
  backfillTrendyolInvoices(): Promise<{
    total: number;
    sent: number;
    skipped: number;
    errors: { orderId: string; message: string }[];
  }> {
    return this.debug.backfillTrendyolInvoices();
  }

  /**
   * One-time: completează seria+numărul facturii (din PDF-ul FGO) pentru
   * comenzile Trendyol migrate care au doar link-ul PDF. Necesare pentru stornare.
   *
   *   POST /debug/trendyol-backfill-invoice-refs
   */
  @Post('trendyol-backfill-invoice-refs')
  @Roles('admin')
  backfillTrendyolInvoiceRefs(): Promise<{
    total: number;
    filled: number;
    skipped: number;
    errors: { orderId: string; message: string }[];
  }> {
    return this.debug.backfillTrendyolInvoiceRefs();
  }

  /**
   * Erorile ofertelor cu „Documentație respinsă” (status `rejected`), agregate pe
   * canal (eMAG / Trendyol) și pe mesaj de eroare, cu numărul de produse afectate
   * și lista exactă de SKU-uri per eroare.
   *
   *   GET /debug/rejected-listings
   */
  @Get('rejected-listings')
  @Roles('admin')
  getRejectedListings(): Promise<RejectedListingsReport> {
    return this.debug.getRejectedListingsReport();
  }

  @Get('requests')
  @Roles('admin')
  @ApiQuery({ name: 'pluginId', required: false })
  @ApiQuery({ name: 'path', required: false })
  @ApiQuery({ name: 'q', required: false, description: 'Search in body/correlation' })
  @ApiQuery({ name: 'sinceMinutes', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listRequests(
    @Query('pluginId') pluginId?: string,
    @Query('path') path?: string,
    @Query('q') q?: string,
    @Query('sinceMinutes', new ParseIntPipe({ optional: true })) sinceMinutes?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<{ data: RequestLogListItem[] }> {
    const since =
      sinceMinutes !== undefined && sinceMinutes > 0
        ? new Date(Date.now() - sinceMinutes * 60_000)
        : undefined;
    const rows = await this.requestLog.list({
      pluginId,
      path,
      search: q,
      since,
      limit,
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        pluginId: r.pluginId,
        method: r.method,
        url: r.url,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        error: r.error,
        correlation: r.correlation,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Returnează toate erorile Zod de validare pre-HTTP înregistrate de worker
   * (intrări sintetice cu url `[validation-error] ...`). Ajută la diagnosticarea
   * push-urilor care eșuează înainte de a ajunge la API-ul marketplace-ului.
   */
  @Get('zod-errors')
  @Roles('admin')
  @ApiQuery({ name: 'sinceMinutes', required: false, type: Number })
  async listZodErrors(
    @Query('sinceMinutes', new ParseIntPipe({ optional: true })) sinceMinutes?: number,
  ): Promise<{ data: RequestLogListItem[] }> {
    const since =
      sinceMinutes !== undefined && sinceMinutes > 0
        ? new Date(Date.now() - sinceMinutes * 60_000)
        : undefined;
    const rows = await this.requestLog.list({ validationErrors: true, since, limit: 500 });
    return {
      data: rows.map((r) => ({
        id: r.id,
        pluginId: r.pluginId,
        method: r.method,
        url: r.url,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        error: r.error,
        correlation: r.correlation,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Get('requests/:id')
  @Roles('admin')
  async getRequest(@Param('id') id: string): Promise<RequestLogDetail> {
    const row = await this.requestLog.getById(id);
    if (!row) throw new NotFoundException(`Request log not found: ${id}`);
    return {
      id: row.id,
      pluginId: row.pluginId,
      method: row.method,
      url: row.url,
      path: row.path,
      status: row.status,
      durationMs: row.durationMs,
      error: row.error,
      correlation: row.correlation,
      createdAt: row.createdAt.toISOString(),
      requestBody: row.requestBody,
      requestHeaders: row.requestHeaders,
      responseBody: row.responseBody,
      responseSizeBytes: row.responseSizeBytes,
    };
  }
}
