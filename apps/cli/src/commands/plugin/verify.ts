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

interface VerifyResult {
  ok: boolean;
  reason?: string;
}

interface LifecycleLike {
  verify(pluginId: string): Promise<VerifyResult>;
}

interface ContextLike {
  get<T>(token: unknown): T;
}

export interface RegisterVerifyDeps {
  contextOptions?: CreateContextOptions;
  registryToken?: unknown;
  lifecycleToken?: unknown;
}

const DEFAULT_REGISTRY_TOKEN = Symbol.for('PluginRegistryService');
const DEFAULT_LIFECYCLE_TOKEN = Symbol.for('PluginLifecycleService');

export function registerVerify(parent: Command, deps: RegisterVerifyDeps = {}): void {
  parent
    .command('verify')
    .argument('<idOrName>', 'Plugin id (uuid) or package name')
    .description('Force health check on a plugin')
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
        const result = await lifecycle.verify(resolved.id);
        if (result.ok) {
          printSuccess(`Plugin ${resolved.packageName} is healthy`);
          return;
        }
        printError(
          `Plugin ${resolved.packageName} health check failed: ${result.reason ?? 'unknown'}`,
        );
        process.exitCode = 1;
      } catch (err) {
        printError('Verify failed', err);
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
