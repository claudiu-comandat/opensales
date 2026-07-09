import { existsSync, statSync } from 'node:fs';

export type PluginSource =
  | { kind: 'path'; path: string }
  | { kind: 'tarball'; path: string }
  | { kind: 'github'; url: string }
  | { kind: 'npm'; spec: string };

export function detectSource(input: string): PluginSource {
  if (input.startsWith('https://github.com/') || input.startsWith('git+https://')) {
    return { kind: 'github', url: input };
  }
  if (input.endsWith('.tgz') || input.endsWith('.tar.gz')) {
    return { kind: 'tarball', path: input };
  }
  if (existsSync(input)) {
    const st = statSync(input);
    if (st.isDirectory()) return { kind: 'path', path: input };
    if (st.isFile() && (input.endsWith('.tgz') || input.endsWith('.tar.gz'))) {
      return { kind: 'tarball', path: input };
    }
  }
  return { kind: 'npm', spec: input };
}
