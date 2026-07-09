import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import type { PluginLogger } from '@opensales/plugin-sdk';

/**
 * Factory ce produce un `PluginLogger` child al loggerului platform,
 * cu binding-uri automate pentru `pluginId` și `packageName`.
 */
@Injectable()
export class SdkLoggerFactory {
  constructor(private readonly base: Logger) {}

  build(input: { pluginId: string; packageName: string }): PluginLogger {
    const tags = { pluginId: input.pluginId, packageName: input.packageName };
    return {
      info: (msg, meta) => this.base.log({ ...tags, ...meta }, msg),
      warn: (msg, meta) => this.base.warn({ ...tags, ...meta }, msg),
      error: (msg, meta) => this.base.error({ ...tags, ...meta }, msg),
      debug: (msg, meta) => this.base.debug({ ...tags, ...meta }, msg),
    };
  }
}
