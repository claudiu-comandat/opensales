import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

export async function buildPlugin(rootDir: string): Promise<void> {
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  if (pkg.scripts?.build) {
    await run('npm', ['install', '--no-audit', '--no-fund'], rootDir);
    await run('npm', ['run', 'build'], rootDir);
  }
}
