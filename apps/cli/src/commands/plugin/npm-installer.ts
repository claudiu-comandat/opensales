import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { extract } from 'tar';

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

export async function installFromNpm(
  spec: string,
  pluginsRoot: string,
  slug: string,
): Promise<string> {
  const dest = join(pluginsRoot, slug);
  const tmp = join(pluginsRoot, `.tmp-${slug}`);
  await mkdir(tmp, { recursive: true });
  await run('npm', ['pack', spec], tmp);
  const { readdirSync } = await import('node:fs');
  const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack produced no tarball');
  await mkdir(dest, { recursive: true });
  await extract({ file: join(tmp, tgz), cwd: dest, strip: 1 });
  return dest;
}
