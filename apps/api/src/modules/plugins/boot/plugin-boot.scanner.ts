import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DB_TOKEN, schema, type Database } from '@opensales/db';
import { isPermission } from '@opensales/plugin-sdk';
import { eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import { ConfigService } from '../../../config/config.service.js';
import { PluginFolderHelper } from '../lifecycle/plugin-folder.helper.js';
import { PluginLoaderService } from '../loader/plugin-loader.service.js';
import { PluginRegistryService } from '../registry/plugin-registry.service.js';

@Injectable()
export class PluginBootScanner implements OnApplicationBootstrap {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly loader: PluginLoaderService,
    private readonly folders: PluginFolderHelper,
    private readonly config: ConfigService,
    private readonly logger: Logger,
    @Inject(DB_TOKEN) private readonly db: Database,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.isTest()) return;
    await this.scan();
  }

  /**
   * Scans pluginsRoot for directories with a manifest.json and registers any
   * plugins not yet in the DB. Built-in plugins get all declared permissions
   * auto-granted so they work without manual approval.
   */
  private async autoRegisterNew(knownPackages: Set<string>): Promise<void> {
    const dirs = await this.folders.listPluginDirs();
    for (const dir of dirs) {
      try {
        const manifest = await this.folders.readManifest(dir);
        if (knownPackages.has(manifest.packageName)) continue;

        for (const p of manifest.permissions) {
          if (!isPermission(p)) {
            this.logger.warn(
              { dir, permission: p },
              'Skipping auto-register: unknown permission in manifest',
            );
            continue;
          }
        }

        const hash = await this.folders.hashDir(dir);
        await this.folders.createDataDir(dir);

        const logoDataUri = await this.folders.readLogoDataUri(dir);

        const id = uuidv7();
        const manifestData: schema.PluginManifest = {
          name: manifest.packageName,
          version: manifest.version,
          displayName: manifest.displayName,
          ...(manifest.description !== undefined ? { description: manifest.description } : {}),
          ...(manifest.type !== undefined ? { type: manifest.type } : {}),
          permissions: [...manifest.permissions],
          capabilities: [...manifest.capabilities],
          ...(manifest.configSchema !== undefined ? { configSchema: manifest.configSchema } : {}),
          ...(manifest.secretSchema !== undefined ? { secretSchema: manifest.secretSchema } : {}),
          ...(logoDataUri !== null ? { logoDataUri } : {}),
        };

        await this.db.insert(schema.plugins).values({
          id,
          packageName: manifest.packageName,
          version: manifest.version,
          displayName: manifest.displayName,
          manifest: manifestData,
          config: {},
          grantedPermissions: [...manifest.permissions],
          status: 'pending_verification',
          hash,
        });

        knownPackages.add(manifest.packageName);
        this.logger.log({ packageName: manifest.packageName }, 'Plugin auto-registered at boot');
      } catch (err) {
        this.logger.warn({ err, dir }, 'Failed to auto-register plugin at boot');
      }
    }
  }

  async scan(): Promise<{ loaded: number; failed: number }> {
    const rows = await this.registry.list();
    const knownPackages = new Set(rows.map((r) => r.packageName));

    await this.autoRegisterNew(knownPackages);

    // Reload the full list so newly registered plugins are included in the load phase.
    const allRows = await this.registry.list();

    let loaded = 0;
    let failed = 0;
    for (const row of allRows) {
      if (row.status === 'disabled') continue;
      const rootDir = this.folders.pathFor(row.packageName);

      // Plugin code is shipped with the platform — a redeploy that rebuilds
      // dist/ legitimately changes the directory hash. Refresh the stored
      // hash before loading so we don't end up in error state every deploy
      // (which would orphan the plugin's encrypted credentials).
      try {
        const currentHash = await this.folders.hashDir(rootDir);
        if (currentHash !== row.hash) {
          await this.db
            .update(schema.plugins)
            .set({ hash: currentHash, updatedAt: new Date() })
            .where(eq(schema.plugins.id, row.id));
          this.logger.log(
            { pluginId: row.id, packageName: row.packageName },
            'Plugin hash refreshed at boot (code redeployed)',
          );
        }
      } catch (err) {
        this.logger.warn({ err, pluginId: row.id }, 'Failed to refresh plugin hash');
      }

      // Sync manifest fields (displayName, type, capabilities, description, version, logoDataUri)
      // from the on-disk manifest.json + logo.svg into the DB on every boot. Lets us evolve
      // manifests in code without manual DB migrations or re-install.
      try {
        const fileManifest = await this.folders.readManifest(rootDir);
        const logoDataUri = await this.folders.readLogoDataUri(rootDir);
        const stored = row.manifest;
        const nextManifest: schema.PluginManifest = {
          ...stored,
          name: fileManifest.packageName,
          version: fileManifest.version,
          displayName: fileManifest.displayName,
          ...(fileManifest.description !== undefined
            ? { description: fileManifest.description }
            : {}),
          ...(fileManifest.type !== undefined ? { type: fileManifest.type } : {}),
          permissions: [...fileManifest.permissions],
          capabilities: [...fileManifest.capabilities],
          ...(logoDataUri !== null ? { logoDataUri } : {}),
        };
        const changed =
          row.displayName !== fileManifest.displayName ||
          row.version !== fileManifest.version ||
          JSON.stringify(stored) !== JSON.stringify(nextManifest);
        if (changed) {
          await this.db
            .update(schema.plugins)
            .set({
              displayName: fileManifest.displayName,
              version: fileManifest.version,
              manifest: nextManifest,
              updatedAt: new Date(),
            })
            .where(eq(schema.plugins.id, row.id));
          this.logger.log(
            { pluginId: row.id, packageName: row.packageName },
            'Plugin manifest synced from disk',
          );
        }
      } catch (err) {
        this.logger.warn({ err, pluginId: row.id }, 'Failed to sync plugin manifest');
      }

      try {
        await this.loader.load({ pluginId: row.id, rootDir });
        // Restore active status if a prior boot had marked it as error due to
        // a transient load failure (e.g. hash mismatch from old deploy).
        if (row.status === 'error') {
          await this.registry.updateStatus(row.id, 'active', null);
        }
        loaded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        this.logger.error(
          { err, pluginId: row.id, packageName: row.packageName },
          'Plugin load failed at boot',
        );
        await this.registry.updateStatus(row.id, 'error', msg);
        failed++;
      }
    }
    this.logger.log({ loaded, failed, total: allRows.length }, 'Plugin boot scan complete');
    return { loaded, failed };
  }
}
