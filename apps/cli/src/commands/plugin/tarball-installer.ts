import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { extract } from 'tar';

export async function installFromTarball(
  tarballPath: string,
  pluginsRoot: string,
  slug: string,
): Promise<string> {
  const dest = join(pluginsRoot, slug);
  await mkdir(dest, { recursive: true });
  await extract({ file: tarballPath, cwd: dest, strip: 1 });
  return dest;
}
