import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { createDb } from '../client.js';
import { plugins } from '../schema/plugins.js';

// ── hashDirectory ─────────────────────────────────────────────────────────────
// Duplicat din apps/api/src/modules/plugins/loader/plugin-hasher.ts.
// Același algoritm, aceeași ordine → hash identic la boot.

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

async function hashDirectory(rootDir: string): Promise<string> {
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

// ── Auto-discover plugin dirs ─────────────────────────────────────────────────
// Reads all subdirectories of pluginsRoot that contain a manifest.json,
// skipping private dirs that start with `_` (e.g. `_example`).

async function discoverPluginDirs(pluginsRoot: string): Promise<string[]> {
  const entries = await readdir(pluginsRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => join(pluginsRoot, e.name));
}

interface RawManifest {
  packageName: string;
  version: string;
  displayName: string;
  description?: string;
  permissions: string[];
  capabilities?: string[];
  configSchema?: unknown;
  secretSchema?: unknown;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SeedPluginsInput {
  databaseUrl: string;
  /** Rădăcina unde trăiesc plugin-urile. Default: process.cwd()/plugins */
  pluginsRoot?: string;
}

export interface SeedPluginsResult {
  installed: string[];
  skipped: string[];
}

async function readLogoDataUri(rootDir: string): Promise<string | undefined> {
  try {
    const content = await readFile(join(rootDir, 'logo.svg'), 'utf8');
    const b64 = Buffer.from(content).toString('base64');
    return `data:image/svg+xml;base64,${b64}`;
  } catch {
    return undefined;
  }
}

export async function seedPlugins(input: SeedPluginsInput): Promise<SeedPluginsResult> {
  const { db, close } = createDb(input.databaseUrl, { max: 1 });
  const pluginsRoot = input.pluginsRoot ?? resolve(process.cwd(), 'plugins');
  const installed: string[] = [];
  const skipped: string[] = [];

  try {
    const pluginDirs = await discoverPluginDirs(pluginsRoot);

    for (const rootDir of pluginDirs) {
      // 1. Citim manifest.json
      let manifest: RawManifest;
      try {
        const raw = await readFile(join(rootDir, 'manifest.json'), 'utf8');
        manifest = JSON.parse(raw) as RawManifest;
      } catch {
        console.warn(`[seed-plugins] Skipping ${rootDir}: manifest.json not found or unreadable`);
        skipped.push(rootDir);
        continue;
      }

      // 2. Logo inline
      const logoDataUri = await readLogoDataUri(rootDir);

      // 3. Hash-uiește directorul (același algoritm ca la boot)
      const hash = await hashDirectory(rootDir);

      // 4. Creează data/ dir (necesar pentru secrets/config)
      await mkdir(join(rootDir, 'data'), { recursive: true });

      const manifestData = {
        name: manifest.packageName,
        version: manifest.version,
        displayName: manifest.displayName,
        ...(manifest.description !== undefined ? { description: manifest.description } : {}),
        permissions: [...manifest.permissions],
        capabilities: [...(manifest.capabilities ?? [])],
        ...(manifest.configSchema !== undefined ? { configSchema: manifest.configSchema } : {}),
        ...(manifest.secretSchema !== undefined ? { secretSchema: manifest.secretSchema } : {}),
        ...(logoDataUri !== undefined ? { logoDataUri } : {}),
      };

      // Built-in plugins get all declared permissions auto-granted — no manual review needed.
      const allPermissions = [...manifest.permissions];

      // 5. Idempotent — actualizează manifest + permisiuni dacă există deja
      const existing = await db
        .select({ id: plugins.id })
        .from(plugins)
        .where(eq(plugins.packageName, manifest.packageName));
      if (existing.length > 0) {
        await db
          .update(plugins)
          .set({
            version: manifest.version,
            displayName: manifest.displayName ?? manifest.packageName,
            manifest: manifestData,
            grantedPermissions: allPermissions,
            hash,
          })
          .where(eq(plugins.packageName, manifest.packageName));
        skipped.push(manifest.packageName);
        continue;
      }

      // 6. Inserează înregistrarea nouă în DB
      await db.insert(plugins).values({
        id: uuidv7(),
        packageName: manifest.packageName,
        version: manifest.version,
        displayName: manifest.displayName ?? manifest.packageName,
        manifest: manifestData,
        config: {},
        grantedPermissions: allPermissions,
        status: 'pending_verification',
        hash,
      });

      installed.push(manifest.packageName);
    }
  } finally {
    await close();
  }

  return { installed, skipped };
}

// ── Rulare directă ────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('plugins.ts') || process.argv[1]?.endsWith('plugins.js')) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[seed-plugins] DATABASE_URL required');
    process.exit(1);
  }
  seedPlugins({
    databaseUrl,
    ...(process.env.PLUGINS_ROOT !== undefined && { pluginsRoot: process.env.PLUGINS_ROOT }),
  })
    .then((res) => {
      if (res.installed.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[seed-plugins] Installed: ${res.installed.join(', ')}`);
      }
      if (res.skipped.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[seed-plugins] Skipped (already present): ${res.skipped.join(', ')}`);
      }
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
