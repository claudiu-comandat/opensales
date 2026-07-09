import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { DomainError } from '../../../errors/domain.error.js';
import { PluginRegistryService } from '../registry/plugin-registry.service.js';

import { PluginPermissionDeniedError } from './permission-denied.error.js';
import { type GatewayHandler } from './permission-gateway.types.js';

@Injectable()
export class PermissionGatewayService {
  private handlers = new Map<string, GatewayHandler>();

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly logger: Logger,
  ) {}

  registerHandler<I, O>(key: string, permission: string, handler: GatewayHandler<I, O>): void {
    if (this.handlers.has(key)) {
      throw new Error(`Gateway handler already registered for key: ${key}`);
    }
    this.handlers.set(key, async (pluginId, input) => {
      const allowed = await this.registry.hasPermission(pluginId, permission);
      if (!allowed) {
        throw new PluginPermissionDeniedError(pluginId, permission);
      }
      return handler(pluginId, input as I);
    });
  }

  async invoke<O = unknown>(pluginId: string, key: string, input: unknown): Promise<O> {
    const handler = this.handlers.get(key);
    if (!handler) {
      throw DomainError.notFound(`Unknown gateway operation: ${key}`);
    }
    this.logger.debug({ pluginId, key }, 'Plugin gateway invoke');
    return (await handler(pluginId, input)) as O;
  }

  registeredKeys(): string[] {
    return Array.from(this.handlers.keys());
  }
}
