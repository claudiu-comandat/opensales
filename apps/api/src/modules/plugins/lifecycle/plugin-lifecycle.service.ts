import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { invokeAction, isPermission, withPluginHttpLog } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { ConfigService } from '../../../config/config.service.js';
import { DomainError } from '../../../errors/domain.error.js';
import { LoadedPluginsRegistry } from '../loader/loaded-plugins.registry.js';
import { PluginLoaderService } from '../loader/plugin-loader.service.js';
import { PluginRegistryService } from '../registry/plugin-registry.service.js';
import { type LoadedPlugin } from '../types.js';

import { PluginFolderHelper } from './plugin-folder.helper.js';

interface OnConfigureCapable {
  onConfigure?: (secrets: Record<string, unknown>) => Promise<void>;
}

@Injectable()
export class PluginLifecycleService {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly loader: PluginLoaderService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly folders: PluginFolderHelper,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  async install(rootDir: string): Promise<{ pluginId: string }> {
    await this.folders.ensureFolder(rootDir);
    const manifest = await this.folders.readManifest(rootDir);

    const existing = await this.registry.findByPackageName(manifest.packageName);
    if (existing) {
      throw DomainError.conflict(`Plugin already installed: ${manifest.packageName}`);
    }

    for (const p of manifest.permissions) {
      if (!isPermission(p)) {
        throw DomainError.validation(`Unknown permission requested: ${String(p)}`);
      }
    }

    const hash = await this.folders.hashDir(rootDir);
    await this.folders.createDataDir(rootDir);

    const row = await this.registry.create({
      packageName: manifest.packageName,
      version: manifest.version,
      displayName: manifest.displayName,
      manifest: {
        name: manifest.packageName,
        version: manifest.version,
        displayName: manifest.displayName,
        ...(manifest.description !== undefined ? { description: manifest.description } : {}),
        ...(manifest.type !== undefined ? { type: manifest.type } : {}),
        permissions: [...manifest.permissions],
        capabilities: [...manifest.capabilities],
        ...(manifest.configSchema !== undefined ? { configSchema: manifest.configSchema } : {}),
        ...(manifest.secretSchema !== undefined ? { secretSchema: manifest.secretSchema } : {}),
      },
      config: {},
      grantedPermissions: [],
      status: 'pending_verification',
      hash,
    });

    this.logger.log({ pluginId: row.id, packageName: manifest.packageName }, 'Plugin installed');
    return { pluginId: row.id };
  }

  async grantPermissions(pluginId: string, perms: string[]): Promise<void> {
    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');

    const declared = new Set<string>(row.manifest.permissions);
    for (const p of perms) {
      if (!isPermission(p)) {
        throw DomainError.validation(`Unknown permission: ${p}`);
      }
      if (!declared.has(p)) {
        throw DomainError.validation(`Permission not declared in manifest: ${p}`);
      }
    }

    await this.registry.updateGrantedPermissions(pluginId, perms);
  }

  async configure(
    pluginId: string,
    payload: { secrets?: Record<string, unknown>; config?: Record<string, unknown> },
  ): Promise<void> {
    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');

    const loaded = await this.ensureLoaded(pluginId, row.packageName, row.hash);

    if (payload.secrets) {
      const candidate = loaded.instance as unknown as OnConfigureCapable;
      if (typeof candidate.onConfigure === 'function') {
        await candidate.onConfigure(payload.secrets);
      } else {
        for (const [k, v] of Object.entries(payload.secrets)) {
          await loaded.context.storage.set(k, v);
        }
      }
    }

    if (payload.config) {
      await this.registry.updateConfig(pluginId, { ...row.config, ...payload.config });
    }
  }

  async verify(pluginId: string): Promise<{ ok: boolean; reason?: string }> {
    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');

    const loaded = await this.ensureLoaded(pluginId, row.packageName, row.hash);

    try {
      // Wrap in the plugin's HTTP log scope so the probe request healthCheck
      // makes (vat read, category list, …) is recorded for the debug page too.
      const r = await withPluginHttpLog(loaded.instance, () => loaded.instance.healthCheck());
      if (r.ok) {
        await this.registry.updateStatus(pluginId, 'active');
        return { ok: true };
      }
      await this.registry.updateStatus(pluginId, 'error', r.reason);
      return { ok: false, reason: r.reason };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      await this.registry.updateStatus(pluginId, 'error', msg);
      return { ok: false, reason: msg };
    }
  }

  async disable(pluginId: string): Promise<void> {
    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');
    await this.loader.unload(pluginId);
    await this.registry.updateStatus(pluginId, 'disabled');
  }

  async enable(pluginId: string): Promise<void> {
    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');
    await this.loader.load({
      pluginId,
      rootDir: this.folders.pathFor(row.packageName),
      expectedHash: row.hash,
    });
    await this.registry.updateStatus(pluginId, 'active');
  }

  async uninstall(pluginId: string): Promise<void> {
    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');
    await this.loader.unload(pluginId);
    await this.registry.remove(pluginId);
    await this.folders.deleteFolder(this.folders.pathFor(row.packageName));
  }

  /**
   * Returns the auto-generated callback URL for this plugin instance.
   * Generates and persists a unique webhook token the first time it's called.
   * Returns null if PUBLIC_API_URL is not configured.
   */
  async getWebhookInfo(pluginId: string): Promise<{
    callbackUrl: string | null;
    token: string;
    awbCallbackUrl: string | null;
    awbCallbackConfigured: boolean;
    documentationApprovedUrl: string | null;
  }> {
    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');

    let token = row.config.webhookToken as string | undefined;
    if (!token) {
      token = randomBytes(32).toString('hex');
      await this.registry.updateConfig(pluginId, { ...row.config, webhookToken: token });
    }

    const baseUrl = this.config.publicApiUrl;
    const callbackUrl = baseUrl ? `${baseUrl}/webhooks/emag/${token}` : null;
    const awbCallbackUrl = baseUrl ? `${baseUrl}/webhooks/emag/${token}/awb-status` : null;
    // Callback "Approved documentation" (documentație validată + PNK primit) —
    // se configurează manual în interfața eMAG Marketplace; accelerează extragerea
    // categoriei/caracteristicilor pentru fluxul de prelistare.
    const documentationApprovedUrl = baseUrl
      ? `${baseUrl}/webhooks/emag/${token}/documentation-approved`
      : null;
    const awbCallbackConfigured =
      (row.config.awbCallbackConfigured as boolean | undefined) ?? false;
    return { callbackUrl, token, awbCallbackUrl, awbCallbackConfigured, documentationApprovedUrl };
  }

  /**
   * Marchează (sau demarchează) că utilizatorul a configurat manual callback URL-ul AWB
   * în interfața Marketplace eMAG. Stocată în plugins.config.awbCallbackConfigured.
   */
  async setAwbCallbackConfigured(pluginId: string, configured: boolean): Promise<void> {
    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');
    await this.registry.updateConfig(pluginId, {
      ...row.config,
      awbCallbackConfigured: configured,
    });
    this.logger.log({ pluginId, configured }, 'AWB callback configured flag updated');
  }

  /**
   * Invokes the plugin's registerCallback action to set the callback URL on eMAG's side.
   * Returns { ok, error } — never throws, so the UI can show the result gracefully.
   */
  async registerCallbackOnEmag(
    pluginId: string,
  ): Promise<{ ok: boolean; error?: string; callbackUrl: string | null }> {
    const { callbackUrl, token: _token } = await this.getWebhookInfo(pluginId);
    if (!callbackUrl) {
      return {
        ok: false,
        error: 'PUBLIC_API_URL nu este configurat. Setează env var PUBLIC_API_URL.',
        callbackUrl: null,
      };
    }

    const row = await this.registry.findById(pluginId);
    if (!row) throw DomainError.notFound('Plugin not found');

    const loaded = await this.ensureLoaded(pluginId, row.packageName, row.hash);

    try {
      await invokeAction(loaded.instance, 'registerCallback', { callbackUrl });
      this.logger.log({ pluginId, callbackUrl }, 'eMAG callback URL registered');
      return { ok: true, callbackUrl };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Eroare necunoscută';
      this.logger.warn({ pluginId, callbackUrl, error }, 'eMAG callback registration failed');
      return { ok: false, error, callbackUrl };
    }
  }

  private async ensureLoaded(
    pluginId: string,
    packageName: string,
    hash: string,
  ): Promise<LoadedPlugin> {
    const existing = this.loaded.getById(pluginId);
    if (existing) return existing;
    return this.loader.load({
      pluginId,
      rootDir: this.folders.pathFor(packageName),
      expectedHash: hash,
    });
  }
}
