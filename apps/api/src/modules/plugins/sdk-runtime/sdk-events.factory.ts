import { Injectable } from '@nestjs/common';

import type { EventName, PluginEventBus } from '@opensales/plugin-sdk';

import { PluginEventsBus } from '../events/plugin-events.bus.js';

/**
 * Factory ce produce un `PluginEventBus` legat la un anumit `pluginId`.
 *
 * - `emit(name, payload)` → `bus.emitFromPlugin(pluginId, name, payload)`,
 *   fire-and-forget; permission-denied și alte erori sunt înghițite (sync API).
 * - `on(name, handler)` → `bus.subscribe(pluginId, name, handler)`;
 *   o eroare la subscribe (ex. permission lipsă) e propagată ca unhandled
 *   rejection — pluginul trebuie să afle la load-time că nu poate asculta.
 */
@Injectable()
export class SdkEventsFactory {
  constructor(private readonly bus: PluginEventsBus) {}

  build(pluginId: string): PluginEventBus {
    return {
      emit: (name: string, payload: unknown): void => {
        void this.bus.emitFromPlugin(pluginId, name, payload).catch(() => undefined);
      },
      on: (name: string, handler: (payload: unknown) => void | Promise<void>): void => {
        void this.bus.subscribe(pluginId, name as EventName, handler).catch((err: unknown) => {
          throw err;
        });
      },
    };
  }
}
