import { cp } from 'node:fs/promises';
import { join } from 'node:path';

export async function installFromPath(
  srcDir: string,
  pluginsRoot: string,
  slug: string,
): Promise<string> {
  const dest = join(pluginsRoot, slug);
  await cp(srcDir, dest, { recursive: true, errorOnExist: false, force: true });
  return dest;
}
