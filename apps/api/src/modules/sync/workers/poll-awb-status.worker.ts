import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { EmagAwbStatusService } from '../../orders/emag-awb-status.service.js';
import { PluginRegistryService } from '../../plugins/registry/plugin-registry.service.js';

const JOB_NAME = 'plugin.poll_awb_status';
/** Cron: la fiecare 4 ore */
const POLL_CRON = '0 */4 * * *';
const EMAG_PACKAGE = '@opensales-plugin/emag';

export interface PollAwbStatusJobData {
  pluginId: string;
}

@Injectable()
export class PollAwbStatusWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: PluginRegistryService,
    private readonly awbStatus: EmagAwbStatusService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;

    await this.queue.register<PollAwbStatusJobData>(JOB_NAME, async (data) => {
      await this.run(data);
    });

    const plugin = await this.registry.findByPackageName(EMAG_PACKAGE);
    if (!plugin) return;

    await this.queue
      .raw()
      .schedule(JOB_NAME, POLL_CRON, { pluginId: plugin.id } satisfies PollAwbStatusJobData, {
        tz: 'UTC',
      });
    this.logger.log({ pluginId: plugin.id }, 'AWB status poll scheduled (every 4h)');
  }

  async run(data: PollAwbStatusJobData): Promise<void> {
    this.logger.log({ pluginId: data.pluginId }, 'AWB status poll started');
    try {
      await this.awbStatus.syncForPlugin(data.pluginId);
      this.logger.log({ pluginId: data.pluginId }, 'AWB status poll completed');
    } catch (err) {
      this.logger.error({ pluginId: data.pluginId, err }, 'AWB status poll failed');
      throw err;
    }
  }

  async enqueue(pluginId: string): Promise<string | null> {
    return this.queue.enqueue<PollAwbStatusJobData>(JOB_NAME, { pluginId });
  }
}
