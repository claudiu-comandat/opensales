import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../jobs/job-queue.service.js';
import { EMAG_RECONCILE_JOB, type EmagReconcileJob } from '../import/push-jobs.js';
import { EmagOrderSyncService } from '../orders/emag-order-sync.service.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { SyncService } from '../sync/sync.service.js';

@ApiTags('Webhooks')
@Controller('webhooks/emag')
export class EmagWebhookController {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly sync: EmagOrderSyncService,
    private readonly syncService: SyncService,
    private readonly queue: JobQueueService,
    private readonly logger: Logger,
  ) {}

  /**
   * eMAG calls this endpoint when a new order is placed.
   * Format: GET /webhooks/emag/:token?order_id=123
   *
   * The token uniquely identifies this OpenSales installation, preventing
   * order mixing between separate instances sharing the same eMAG account.
   */
  @Get(':token')
  async handleCallback(
    @Param('token') token: string,
    @Query('order_id') orderIdRaw: string,
  ): Promise<{ ok: boolean }> {
    const orderId = parseInt(orderIdRaw, 10);
    if (!orderIdRaw || isNaN(orderId)) {
      this.logger.warn({ token, orderIdRaw }, 'eMAG webhook: missing or invalid order_id');
      return { ok: false };
    }

    // Find which plugin owns this token
    const plugin = await this.findPluginByToken(token);
    if (!plugin) {
      this.logger.warn({ token, orderId }, 'eMAG webhook: unknown token — ignoring');
      // Return 200 to prevent eMAG from retrying indefinitely
      return { ok: false };
    }

    this.logger.log({ pluginId: plugin.id, orderId }, 'eMAG webhook received');

    // Process asynchronously — respond immediately so eMAG doesn't time out
    void this.sync.syncSingleOrder(plugin.id, orderId).catch((err: unknown) => {
      this.logger.error({ pluginId: plugin.id, orderId, err }, 'eMAG webhook sync failed');
    });

    return { ok: true };
  }

  /**
   * eMAG calls this endpoint when an AWB status changes.
   * Format: GET /webhooks/emag/:token/awb-status (query params unknown — logged for future reference)
   *
   * Triggers an immediate AWB status poll for the plugin instead of waiting
   * for the scheduled 4-hour cron job.
   */
  @Get(':token/awb-status')
  async handleAwbStatusCallback(
    @Param('token') token: string,
    @Query() query: Record<string, string>,
  ): Promise<{ ok: boolean }> {
    const plugin = await this.findPluginByToken(token);
    if (!plugin) {
      this.logger.warn({ token, query }, 'eMAG AWB webhook: unknown token — ignoring');
      return { ok: false };
    }

    this.logger.log({ pluginId: plugin.id, query }, 'eMAG AWB status webhook received');

    void this.syncService.enqueueAwbPoll(plugin.id).catch((err: unknown) => {
      this.logger.error({ pluginId: plugin.id, err }, 'eMAG AWB webhook enqueue failed');
    });

    return { ok: true };
  }

  /**
   * eMAG calls this endpoint when product documentation is validated and receives a PNK
   * (callback "Approved documentation" din interfața Marketplace).
   * Format: GET /webhooks/emag/:token/documentation-approved (query params necunoscute —
   * le logăm integral ca să învățăm formatul empiric).
   *
   * Declanșează imediat un ciclu de reconciliere eMAG (în loc să așteptăm cron-ul de 2h) —
   * reconcile-ul extrage categoria/caracteristicile atribuite pentru listing-urile prelist.
   * Guard-ul in-memory `running` din EmagReconcileWorker absoarbe burst-urile.
   */
  @Get(':token/documentation-approved')
  async handleDocumentationApproved(
    @Param('token') token: string,
    @Query() query: Record<string, string>,
  ): Promise<{ ok: boolean }> {
    const plugin = await this.findPluginByToken(token);
    if (!plugin) {
      this.logger.warn({ token, query }, 'eMAG documentation webhook: unknown token — ignoring');
      // Return 200 to prevent eMAG from retrying indefinitely
      return { ok: false };
    }

    this.logger.log({ pluginId: plugin.id, query }, 'eMAG documentation-approved webhook received');

    await this.queue.enqueue<EmagReconcileJob>(EMAG_RECONCILE_JOB, { pluginId: plugin.id });

    return { ok: true };
  }

  private async findPluginByToken(
    token: string,
  ): Promise<{ id: string; packageName: string } | null> {
    const all = await this.registry.list();
    for (const p of all) {
      const webhookToken = p.config.webhookToken;
      if (webhookToken === token) {
        return { id: p.id, packageName: p.packageName };
      }
    }
    return null;
  }
}
