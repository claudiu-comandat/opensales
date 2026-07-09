import { join } from 'node:path';

import { type Command } from 'commander';

import { printError, printSuccess } from '../../output.js';

import { buildPlugin } from './builder.js';
import { installFromGithub } from './github-installer.js';
import { installFromNpm } from './npm-installer.js';
import { installFromPath } from './path-installer.js';
import { detectSource } from './source-detector.js';
import { installFromTarball } from './tarball-installer.js';

function slugFor(input: string): string {
  return input
    .replace(/^.*[/\\]/, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .toLowerCase();
}

export function registerInstall(
  parent: Command,
  pluginsRoot: string = join(process.cwd(), 'plugins'),
): void {
  parent
    .command('install')
    .argument('<source>', 'path | tarball | github url | npm spec')
    .description('Install a plugin from a path, tarball, github URL, or npm spec')
    .action(async (source: string) => {
      try {
        const detected = detectSource(source);
        const slug = slugFor(source);
        let rootDir: string;
        switch (detected.kind) {
          case 'path':
            rootDir = await installFromPath(detected.path, pluginsRoot, slug);
            break;
          case 'tarball':
            rootDir = await installFromTarball(detected.path, pluginsRoot, slug);
            break;
          case 'github':
            rootDir = await installFromGithub(detected.url, pluginsRoot, slug);
            await buildPlugin(rootDir);
            break;
          case 'npm':
            rootDir = await installFromNpm(detected.spec, pluginsRoot, slug);
            break;
        }
        printSuccess(`Installed plugin from ${detected.kind}`, { kind: detected.kind, rootDir });
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
