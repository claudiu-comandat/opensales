import type { Plugin, PluginContext } from '@opensales/plugin-sdk';

export interface LoadedPlugin {
  pluginId: string;
  packageName: string;
  version: string;
  hash: string;
  manifestPath: string;
  rootDir: string;
  instance: Plugin;
  context: PluginContext;
}
