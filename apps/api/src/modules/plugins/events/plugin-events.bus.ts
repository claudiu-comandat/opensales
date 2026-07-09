import { EventEmitter } from 'node:events';

import { Injectable } from '@nestjs/common';
import {
  type EventHandlerMap,
  type EventName,
  isCustomEvent,
  isPlatformEvent,
} from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { DomainError } from '../../../errors/domain.error.js';
import { PluginPermissionDeniedError } from '../gateway/permission-denied.error.js';
import { PluginRegistryService } from '../registry/plugin-registry.service.js';

interface PluginListener {
  pluginId: string;
  handler: (payload: unknown) => void;
}

@Injectable()
export class PluginEventsBus {
  private readonly emitter = new EventEmitter();
  /** Per-event list of plugin listeners — needed to revoke per-plugin. */
  private readonly listenersByEvent = new Map<string, PluginListener[]>();

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly logger: Logger,
  ) {
    this.emitter.setMaxListeners(100);
  }

  /** Platform-side emit — bypass permission check (it's the platform itself). */
  emitFromPlatform(event: EventName, payload: unknown): void {
    if (!isPlatformEvent(event) && !isCustomEvent(event)) {
      throw DomainError.validation(`Invalid event name: ${String(event)}`);
    }
    this.dispatch(event, payload);
  }

  /**
   * Platform-side subscribe for internal services (NOT plugins): no permission
   * check, lives for the app lifetime. Use for reactive platform logic such as
   * fanning a `stock.changed` event out to marketplace update jobs.
   */
  onPlatform(event: EventName, handler: (payload: unknown) => void | Promise<void>): void {
    if (!isPlatformEvent(event) && !isCustomEvent(event)) {
      throw DomainError.validation(`Invalid event name: ${String(event)}`);
    }
    const safe = (payload: unknown): void => {
      void (async (): Promise<void> => {
        try {
          await handler(payload);
        } catch (err) {
          this.logger.warn({ err, event }, 'Platform event handler threw');
        }
      })();
    };
    this.emitter.on(event, safe);
  }

  /** Plugin-side emit — only `custom.*` allowed; requires `events:emit`. */
  async emitFromPlugin(pluginId: string, event: string, payload: unknown): Promise<void> {
    if (!isCustomEvent(event)) {
      throw DomainError.validation('Plugins can only emit custom.* events');
    }
    const allowed = await this.registry.hasPermission(pluginId, 'events:emit');
    if (!allowed) throw new PluginPermissionDeniedError(pluginId, 'events:emit');
    this.dispatch(event, payload);
  }

  /** Plugin-side subscribe — requires `events:subscribe`. */
  async subscribe(
    pluginId: string,
    event: EventName,
    handler: (payload: unknown) => void | Promise<void>,
  ): Promise<void> {
    if (!isPlatformEvent(event) && !isCustomEvent(event)) {
      throw DomainError.validation(`Invalid event name: ${String(event)}`);
    }
    const allowed = await this.registry.hasPermission(pluginId, 'events:subscribe');
    if (!allowed) throw new PluginPermissionDeniedError(pluginId, 'events:subscribe');

    const safe = (payload: unknown): void => {
      void (async (): Promise<void> => {
        try {
          await handler(payload);
        } catch (err) {
          this.logger.warn({ err, event, pluginId }, 'Plugin event handler threw');
        }
      })();
    };
    this.emitter.on(event, safe);

    const listeners = this.listenersByEvent.get(event) ?? [];
    listeners.push({ handler: safe, pluginId });
    this.listenersByEvent.set(event, listeners);
  }

  /**
   * Platform-side subscribe for static `_eventHandlers` declared via `definePlugin`.
   * No permission check — equivalent to `emitFromPlatform` but for subscriptions.
   * Called by the plugin loader after `init()`.
   */
  subscribeHandlers(pluginId: string, handlers: EventHandlerMap): void {
    for (const [event, handlerFn] of Object.entries(handlers)) {
      if (!handlerFn) continue;
      const safe = (payload: unknown): void => {
        void (async (): Promise<void> => {
          try {
            await handlerFn(payload);
          } catch (err) {
            this.logger.warn({ err, event, pluginId }, 'Plugin event handler threw');
          }
        })();
      };
      this.emitter.on(event, safe);
      const listeners = this.listenersByEvent.get(event) ?? [];
      listeners.push({ handler: safe, pluginId });
      this.listenersByEvent.set(event, listeners);
    }
  }

  /** Remove all listeners for a plugin (called at unload). */
  unsubscribeAll(pluginId: string): void {
    for (const [event, listeners] of this.listenersByEvent.entries()) {
      const remaining: PluginListener[] = [];
      for (const l of listeners) {
        if (l.pluginId === pluginId) {
          this.emitter.off(event, l.handler);
        } else {
          remaining.push(l);
        }
      }
      this.listenersByEvent.set(event, remaining);
    }
  }

  private dispatch(event: string, payload: unknown): void {
    this.logger.debug({ event }, 'Event dispatch');
    this.emitter.emit(event, payload);
  }
}
