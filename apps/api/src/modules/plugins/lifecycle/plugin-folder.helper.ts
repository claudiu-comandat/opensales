import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { parseManifest, type PluginManifest } from '@opensales/plugin-sdk';

import { ConfigService } from '../../../config/config.service.js';
import { DomainError } from '../../../errors/domain.error.js';
import { hashDirectory } from '../loader/plugin-hasher.js';

@Injectable()
export class PluginFolderHelper {
  constructor(private readonly config: ConfigService) {}

  pluginsRoot(): string {
    return this.config.pluginsRoot;
  }

  /**
   * Translate a scoped npm name into the plugin directory path.
   * E.g. `@opensales-plugin/emag` -> `<pluginsRoot>/emag`.
   * Convention: directory name = the package slug (part after last `/`).
   */
  pathFor(packageName: string): string {
    const parts = packageName.split('/');
    const slug = parts.at(-1) ?? packageName;
    return join(this.pluginsRoot(), slug);
  }

  /**
   * Returns paths to all plugin subdirectories in pluginsRoot().
   * Skips directories that start with `_` (e.g. `_example`).
   */
  async listPluginDirs(): Promise<string[]> {
    try {
      const entries = await readdir(this.pluginsRoot(), { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
        .map((e) => join(this.pluginsRoot(), e.name));
    } catch {
      return [];
    }
  }

  /**
   * Reads `logo.svg` from a plugin directory and returns a base64 data URI.
   * Returns null if the file doesn't exist.
   */
  async readLogoDataUri(rootDir: string): Promise<string | null> {
    try {
      const content = await readFile(join(rootDir, 'logo.svg'), 'utf8');
      const b64 = Buffer.from(content).toString('base64');
      return `data:image/svg+xml;base64,${b64}`;
    } catch {
      return null;
    }
  }

  async hashDir(rootDir: string): Promise<string> {
    return hashDirectory(rootDir);
  }

  async ensureFolder(rootDir: string): Promise<void> {
    const s = await stat(rootDir).catch(() => null);
    if (!s?.isDirectory()) {
      throw DomainError.notFound(`Plugin folder not found: ${rootDir}`);
    }
  }

  async readManifest(rootDir: string): Promise<PluginManifest> {
    const raw = await readFile(join(rootDir, 'manifest.json'), 'utf8');
    return parseManifest(JSON.parse(raw) as unknown);
  }

  async createDataDir(rootDir: string): Promise<void> {
    await mkdir(join(rootDir, 'data'), { recursive: true, mode: 0o700 });
  }

  async deleteFolder(rootDir: string): Promise<void> {
    await rm(rootDir, { recursive: true, force: true });
  }
}
