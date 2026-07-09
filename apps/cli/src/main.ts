#!/usr/bin/env node
import { Command } from 'commander';

import { registerPluginCommands } from './commands/plugin.js';
import { disposeApplicationContext } from './di.js';
import { printError, setOutputFormat } from './output.js';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('opensales')
    .description('OpenSales platform CLI')
    .version('0.0.0')
    .option('-o, --output <format>', 'Output format: text or json', 'text')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts<{ output?: string }>();
      const fmt = opts.output === 'json' ? 'json' : 'text';
      setOutputFormat(fmt);
    });

  const plugin = program.command('plugin').description('Manage plugins');
  registerPluginCommands(plugin);

  return program;
}

async function run(argv: readonly string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } finally {
    await disposeApplicationContext();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/') ?? ''}`;
if (isMain) {
  run(process.argv).catch((err: unknown) => {
    printError('command failed', err);
    void disposeApplicationContext().finally(() => process.exit(1));
  });
}
