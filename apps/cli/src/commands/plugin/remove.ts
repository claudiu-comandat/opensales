import { type Command } from 'commander';

import { createApplicationContext, type CreateContextOptions } from '../../di.js';
import { printError, printSuccess } from '../../output.js';

interface PluginRecord {
  id: string;
  packageName: string;
}

interface RegistryLike {
  findByPackageName(name: string): Promise<PluginRecord | null>;
  findById?(id: string): Promise<PluginRecord | null>;
}

interface LifecycleLike {
  uninstall(pluginId: string): Promise<void>;
}

interface ContextLike {
  get<T>(token: unknown): T;
}

export interface RegisterRemoveDeps {
  contextOptions?: CreateContextOptions;
  registryToken?: unknown;
  lifecycleToken?: unknown;
}

const DEFAULT_REGISTRY_TOKEN = Symbol.for('PluginRegistryService');
const DEFAULT_LIFECYCLE_TOKEN = Symbol.for('PluginLifecycleService');

export function registerRemove(parent: Command, deps: RegisterRemoveDeps = {}): void {
  parent
    .command('remove')
    .alias('uninstall')
    .argument('<idOrName>', 'Plugin id (uuid) or package name')
    .description('Uninstall a plugin (deletes folder + DB row)')
    .action(async (idOrName: string) => {
      try {
        const ctx = (await createApplicationContext(
          deps.contextOptions ?? {},
        )) as unknown as ContextLike;
        const registry = ctx.get<RegistryLike>(deps.registryToken ?? DEFAULT_REGISTRY_TOKEN);
        const lifecycle = ctx.get<LifecycleLike>(deps.lifecycleToken ?? DEFAULT_LIFECYCLE_TOKEN);
        const resolved = await resolvePlugin(registry, idOrName);
        if (!resolved) {
          printError(`Plugin not found: ${idOrName}`);
          process.exitCode = 1;
          return;
        }
        await lifecycle.uninstall(resolved.id);
        printSuccess(`Plugin ${resolved.packageName} uninstalled`);
      } catch (err) {
        printError('Remove failed', err);
        process.exitCode = 1;
      }
    });
}

async function resolvePlugin(
  registry: RegistryLike,
  idOrName: string,
): Promise<PluginRecord | null> {
  const byName = await registry.findByPackageName(idOrName);
  if (byName) return byName;
  if (typeof registry.findById === 'function') {
    return registry.findById(idOrName);
  }
  return null;
}
