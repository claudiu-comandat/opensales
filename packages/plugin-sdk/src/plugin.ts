import { httpLogStore } from './http-logging.js';

import type { ActionHandlerMap } from './action-handler.js';
import type { PluginContext } from './context.js';
import type { EventName } from './events.js';
import type { PluginManifest } from './manifest.js';

export type PluginHealthCheck = { ok: true } | { ok: false; reason: string };

export type EventHandlerMap = Partial<
  Record<EventName, (payload: unknown) => Promise<void> | void>
>;

export interface Plugin {
  readonly manifest: PluginManifest;

  init(ctx: PluginContext): Promise<void>;
  healthCheck(): Promise<PluginHealthCheck>;
  destroy(): Promise<void>;

  /** Optional: called after secrets are configured. */
  onConfigure?(secrets: Record<string, unknown>): Promise<void>;

  /**
   * Internal — populated by definePlugin. Used by platform to invoke specific
   * actions or dispatch events. Not part of public Plugin contract.
   */
  readonly _actions?: ActionHandlerMap | undefined;
  readonly _eventHandlers?: EventHandlerMap | undefined;
}

export interface DefinePluginInput {
  manifest: PluginManifest;
  actions?: ActionHandlerMap | undefined;
  events?: EventHandlerMap | undefined;
  init: (ctx: PluginContext) => Promise<void>;
  healthCheck: () => Promise<PluginHealthCheck>;
  destroy: () => Promise<void>;
  onConfigure?: ((secrets: Record<string, unknown>) => Promise<void>) | undefined;
}

export function definePlugin(input: DefinePluginInput): Plugin {
  const plugin: Plugin = {
    manifest: input.manifest,
    init: input.init,
    healthCheck: input.healthCheck,
    destroy: input.destroy,
    ...(input.onConfigure ? { onConfigure: input.onConfigure } : {}),
    _actions: input.actions,
    _eventHandlers: input.events,
  };
  return plugin;
}

/**
 * Maps a loaded plugin instance to its platform-provided context. Populated by
 * the host loader via {@link bindPluginContext} so {@link invokeAction} can
 * scope the active HTTP log sink without threading it through every call site.
 */
const pluginContexts = new WeakMap<Plugin, PluginContext>();

/**
 * Associate a plugin instance with its context. The host calls this once, right
 * after building the context and before invoking actions, so that automatic
 * HTTP request logging can find the plugin's sink during {@link invokeAction}.
 */
export function bindPluginContext(plugin: Plugin, ctx: PluginContext): void {
  pluginContexts.set(plugin, ctx);
}

/**
 * Run `fn` inside the plugin's HTTP log async scope so that every outbound
 * `fetch` it makes is recorded automatically (see installLoggingFetch). Use
 * this to wrap ANY host → plugin call that may hit the network — not just
 * actions, but also `healthCheck`, `onConfigure`, etc.
 */
export function withPluginHttpLog<T>(plugin: Plugin, fn: () => T): T {
  return httpLogStore.run(pluginContexts.get(plugin)?.httpLog, fn);
}

/**
 * Helper: invoke a registered action with Zod validation on input/output.
 * Used by the platform's plugin invocation path. Runs inside the plugin's
 * HTTP log scope so its requests are auto-recorded.
 */
export async function invokeAction(
  plugin: Plugin,
  actionName: string,
  rawInput: unknown,
): Promise<unknown> {
  const handler = plugin._actions?.[actionName];
  if (!handler) {
    throw new Error(`Plugin has no action: ${actionName}`);
  }
  const input = handler.input.parse(rawInput);
  const output = await withPluginHttpLog(plugin, () => handler.handle(input));
  return handler.output.parse(output);
}
