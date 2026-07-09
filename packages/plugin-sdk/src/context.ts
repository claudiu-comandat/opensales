export interface PluginLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export interface PluginSecretStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface PluginHttpLogEntry {
  method: string;
  url: string;
  path: string;
  requestBody?: unknown;
  requestHeaders?: Record<string, string> | undefined;
  status?: number | undefined;
  responseBody?: unknown;
  durationMs?: number | undefined;
  error?: string | undefined;
  /** Free-form fields the plugin extracts for search (e.g. { externalOrderId: 123 }). */
  correlation?: Record<string, string | number> | undefined;
}

/**
 * Optional hook a plugin can call after every external HTTP request to log
 * it for the platform's debug UI. The platform wires this to a persistent
 * store; if absent (e.g. in tests), implementations must be a no-op.
 */
export type PluginHttpLogFn = (entry: PluginHttpLogEntry) => void;

export interface PluginContext {
  pluginId: string;
  logger: PluginLogger;
  /** Encrypted secret storage. Alias for `secrets`. */
  storage: PluginSecretStorage;
  /** Alias for `storage` — preferred name in plugin code. */
  secrets: PluginSecretStorage;
  api: PluginApiClient;
  events: PluginEventBus;
  /** Platform-provided sink for external HTTP request traces. Optional. */
  httpLog?: PluginHttpLogFn | undefined;
}

export interface PluginApiClient {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

export interface PluginEventBus {
  emit(event: string, payload: unknown): void;
  on(event: string, handler: (payload: unknown) => void | Promise<void>): void;
}
