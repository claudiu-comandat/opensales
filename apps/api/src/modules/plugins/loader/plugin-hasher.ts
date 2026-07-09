import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Compute a deterministic SHA-256 of a directory's content.
 * Skips `node_modules`, `data/` (mutable), `.git`, coverage, and tsbuildinfo files.
 */
export async function hashDirectory(rootDir: string): Promise<string> {
  const hash = createHash('sha256');
  const files = await listFiles(rootDir);
  files.sort(); // deterministic
  for (const f of files) {
    const rel = relative(rootDir, f);
    const content = await readFile(f);
    hash.update(rel);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

const SKIP = new Set(['node_modules', 'data', '.git', 'coverage']);

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir);
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    if (e.endsWith('.tsbuildinfo')) continue;
    const full = join(dir, e);
    const s = await stat(full);
    if (s.isDirectory()) {
      out.push(...(await listFiles(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}
