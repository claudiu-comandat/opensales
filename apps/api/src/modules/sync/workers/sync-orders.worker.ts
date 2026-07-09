import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../../plugins/registry/plugin-registry.service.js';

const JOB_NAME = 'plugin.sync_orders';

export interface SyncOrdersJobData {
  pluginId: string;
}

@Injectable()
export class SyncOrdersWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<SyncOrdersJobData>(JOB_NAME, async (data) => {
      await this.run(data);
    });
  }

  async run(data: SyncOrdersJobData): Promise<void> {
    const plugin = await this.registry.findById(data.pluginId);
    if (plugin?.status !== 'active') {
      this.logger.warn({ pluginId: data.pluginId }, 'Skipping sync — plugin not active');
      return;
    }
    const loaded = this.loaded.getById(data.pluginId);
    if (!loaded) {
      this.logger.error({ pluginId: data.pluginId }, 'Plugin not loaded — cannot sync');
      return;
    }
    if (!loaded.instance._actions?.syncOrders) {
      this.logger.warn({ pluginId: data.pluginId }, 'Plugin does not implement syncOrders');
      return;
    }
    try {
      await invokeAction(loaded.instance, 'syncOrders', {});
      this.logger.log({ pluginId: data.pluginId }, 'syncOrders OK');
    } catch (err) {
      this.logger.error({ err, pluginId: data.pluginId }, 'syncOrders failed');
      throw err;
    }
  }

  async enqueue(pluginId: string): Promise<string | null> {
    return this.queue.enqueue<SyncOrdersJobData>(JOB_NAME, { pluginId });
  }
}
