import { type Command } from 'commander';

import { createApplicationContext, type CreateContextOptions } from '../../di.js';
import { printError, printTable } from '../../output.js';

interface PluginRecord {
  packageName: string;
  version: string;
  status: string;
  manifest?: { type?: string } | null;
  grantedPermissions?: readonly string[];
}

interface RegistryLike {
  list(): Promise<readonly PluginRecord[]>;
}

interface ContextLike {
  get<T>(token: unknown): T;
}

export interface RegisterListDeps {
  contextOptions?: CreateContextOptions;
  registryToken?: unknown;
}

const DEFAULT_REGISTRY_TOKEN = Symbol.for('PluginRegistryService');

export function registerList(parent: Command, deps: RegisterListDeps = {}): void {
  parent
    .command('list')
    .description('List installed plugins')
    .action(async () => {
      try {
        const ctx = (await createApplicationContext(
          deps.contextOptions ?? {},
        )) as unknown as ContextLike;
        const registry = ctx.get<RegistryLike>(deps.registryToken ?? DEFAULT_REGISTRY_TOKEN);
        const plugins = await registry.list();
        printTable(
          ['PACKAGE', 'VERSION', 'STATUS', 'TYPE', 'PERMISSIONS'],
          plugins.map((p) => [
            p.packageName,
            p.version,
            p.status,
            p.manifest?.type ?? '-',
            String(p.grantedPermissions?.length ?? 0),
          ]),
        );
      } catch (err) {
        printError('List failed', err);
        process.exitCode = 1;
      }
    });
}
