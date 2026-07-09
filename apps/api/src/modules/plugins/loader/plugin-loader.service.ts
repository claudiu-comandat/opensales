import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Injectable } from '@nestjs/common';
import {
  bindPluginContext,
  isPlatformVersionCompatible,
  parseManifest,
  type Plugin,
} from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { ConfigService } from '../../../config/config.service.js';
import { DomainError } from '../../../errors/domain.error.js';
import { PluginEventsBus } from '../events/plugin-events.bus.js';
import { type LoadedPlugin } from '../types.js';

import { LoadedPluginsRegistry } from './loaded-plugins.registry.js';
import { PluginContextFactory } from './plugin-context.factory.js';
import { hashDirectory } from './plugin-hasher.js';

@Injectable()
export class PluginLoaderService {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: LoadedPluginsRegistry,
    private readonly contextFactory: PluginContextFactory,
    private readonly eventsBus: PluginEventsBus,
    private readonly logger: Logger,
  ) {}

  async load(input: {
    pluginId: string;
    rootDir: string;
    expectedHash?: string | undefined;
  }): Promise<LoadedPlugin> {
    const manifestPath = join(input.rootDir, 'manifest.json');
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = parseManifest(JSON.parse(raw) as unknown);

    // Platform compatibility
    const platformVersion = process.env.PLATFORM_VERSION ?? '0.1.0';
    if (!isPlatformVersionCompatible(manifest.platformVersion, platformVersion)) {
      throw DomainError.validation(
        `Plugin ${manifest.packageName} requires platform ${manifest.platformVersion}, current is ${platformVersion}`,
      );
    }

    // Hash integrity
    const hash = await hashDirectory(input.rootDir);
    if (input.expectedHash !== undefined && input.expectedHash !== hash) {
      throw DomainError.validation(
        `Plugin ${manifest.packageName} hash mismatch — folder modified since install`,
      );
    }

    // Dynamic import (pathToFileURL required for ESM on Windows)
    const entry = pathToFileURL(resolve(input.rootDir, manifest.entrypoint)).href;
    const mod = (await import(entry)) as { default?: unknown };
    const candidate = mod.default;
    if (!isPluginInstance(candidate)) {
      throw DomainError.validation(
        `Plugin ${manifest.packageName} does not export a default Plugin instance`,
      );
    }

    const context = this.contextFactory.build({
      pluginId: input.pluginId,
      packageName: manifest.packageName,
      rootDir: input.rootDir,
      parentLogger: this.logger,
    });

    // Bind context so invokeAction can scope this plugin's HTTP log sink,
    // making every outbound fetch the plugin makes auto-recorded for debug.
    bindPluginContext(candidate, context);

    await candidate.init(context);

    // Subscribe static _eventHandlers declared via definePlugin({ events: {...} }).
    // Platform-level — no permission check, same pattern as emitFromPlatform.
    if (candidate._eventHandlers && Object.keys(candidate._eventHandlers).length > 0) {
      this.eventsBus.subscribeHandlers(input.pluginId, candidate._eventHandlers);
    }

    const loaded: LoadedPlugin = {
      pluginId: input.pluginId,
      packageName: manifest.packageName,
      version: manifest.version,
      hash,
      manifestPath,
      rootDir: input.rootDir,
      instance: candidate,
      context,
    };
    this.registry.register(loaded);
    this.logger.log(
      { pluginId: input.pluginId, packageName: manifest.packageName },
      'Plugin loaded',
    );
    return loaded;
  }

  async unload(pluginId: string): Promise<void> {
    const p = this.registry.unregister(pluginId);
    if (!p) return;
    // Unsubscribe all event handlers before destroy so stale listeners don't fire.
    this.eventsBus.unsubscribeAll(pluginId);
    try {
      await p.instance.destroy();
    } catch (err) {
      this.logger.warn({ err, pluginId }, 'Plugin destroy threw');
    }
  }
}

function isPluginInstance(v: unknown): v is Plugin {
  return (
    typeof v === 'object' &&
    v !== null &&
    'manifest' in v &&
    'init' in v &&
    typeof (v as Plugin).init === 'function' &&
    'healthCheck' in v &&
    typeof (v as Plugin).healthCheck === 'function' &&
    'destroy' in v &&
    typeof (v as Plugin).destroy === 'function'
  );
}
