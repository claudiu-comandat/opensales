import { Inject, Injectable, Optional } from '@nestjs/common';
import { type Database, DB_TOKEN } from '@opensales/db';
import {
  type PluginApiClient,
  type PluginContext,
  type PluginHttpLogFn,
  type PluginLogger,
} from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { MasterKeyService } from '../../platform/master-key.service.js';
import { PluginRequestLogService } from '../../plugin-request-log/plugin-request-log.service.js';
import { SdkApiFactory } from '../sdk-runtime/sdk-api.factory.js';
import { SdkLoggerFactory } from '../sdk-runtime/sdk-logger.factory.js';

import { DbSecretStorage } from './db-secret-storage.js';

@Injectable()
export class PluginContextFactory {
  constructor(
    private readonly masterKey: MasterKeyService,
    @Inject(DB_TOKEN) private readonly db: Database,
    @Optional() private readonly loggerFactory?: SdkLoggerFactory,
    @Optional() private readonly requestLog?: PluginRequestLogService,
    @Optional() private readonly sdkApiFactory?: SdkApiFactory,
  ) {}

  build(input: {
    pluginId: string;
    packageName: string;
    rootDir: string;
    parentLogger?: Logger;
  }): PluginContext {
    const logger: PluginLogger = this.loggerFactory
      ? this.loggerFactory.build({ pluginId: input.pluginId, packageName: input.packageName })
      : this.fallbackLogger(input.pluginId, input.parentLogger);

    const storage = new DbSecretStorage(
      this.db,
      input.pluginId,
      this.masterKey.key,
      input.packageName,
    );

    // Bind the plugin id so the plugin doesn't have to know it.
    // Fire-and-forget: never await inside the plugin's request path.
    const httpLog: PluginHttpLogFn | undefined = this.requestLog
      ? (entry) => {
          void this.requestLog?.record({ pluginId: input.pluginId, ...entry });
        }
      : undefined;

    return {
      pluginId: input.pluginId,
      logger,
      storage,
      secrets: storage,
      // SdkApiClient exposes typed domain methods (orders, products, …).
      // PluginApiClient types it as { request() } — cast intentional; plugins
      // that need domain access cast back to SdkApiClient via getSdkApi().
      api: (this.sdkApiFactory
        ? this.sdkApiFactory.build(input.pluginId)
        : {
            request: (): never => {
              throw new Error('plugin api not yet wired');
            },
          }) as unknown as PluginApiClient,
      events: { emit: () => undefined, on: () => undefined },
      httpLog,
    };
  }

  private fallbackLogger(pluginId: string, parent?: Logger): PluginLogger {
    if (!parent) {
      const noop = (): void => undefined;
      return { info: noop, warn: noop, error: noop, debug: noop };
    }
    return {
      info: (msg, meta) => parent.log({ pluginId, ...(meta ?? {}) }, msg),
      warn: (msg, meta) => parent.warn({ pluginId, ...(meta ?? {}) }, msg),
      error: (msg, meta) => parent.error({ pluginId, ...(meta ?? {}) }, msg),
      debug: (msg, meta) => parent.debug({ pluginId, ...(meta ?? {}) }, msg),
    };
  }
}
