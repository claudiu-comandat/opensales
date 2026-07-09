import { type Command } from 'commander';

import { printSuccess } from '../output.js';

import { registerInstall } from './plugin/install.js';
import { registerList } from './plugin/list.js';
import { registerRemove } from './plugin/remove.js';
import { registerVerify } from './plugin/verify.js';

/**
 * Registers the `plugin` subcommand tree.
 *
 * `install` lands in T2.20; `list`, `remove`, and `verify` are wired here as
 * part of T2.21. The `hello` smoke-test action remains so the framework can
 * be exercised end-to-end without a live application context.
 */
export function registerPluginCommands(plugin: Command): Command {
  plugin
    .command('hello')
    .description('Smoke test — verifies the CLI framework is wired up')
    .action(() => {
      printSuccess('CLI is alive');
    });

  registerInstall(plugin);
  registerList(plugin);
  registerRemove(plugin);
  registerVerify(plugin);

  return plugin;
}
