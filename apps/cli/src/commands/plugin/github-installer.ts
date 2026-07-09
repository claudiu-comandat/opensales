import { join } from 'node:path';

import { simpleGit, type SimpleGit } from 'simple-git';

export async function installFromGithub(
  url: string,
  pluginsRoot: string,
  slug: string,
): Promise<string> {
  const dest = join(pluginsRoot, slug);
  const cleanUrl = url.replace(/^git\+/, '');
  const git: SimpleGit = simpleGit();
  await git.clone(cleanUrl, dest, ['--depth', '1']);
  return dest;
}
