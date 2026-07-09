import { Injectable } from '@nestjs/common';
import { type schema } from '@opensales/db';

import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';

import { getMarketplace, type MarketplaceInfo } from './marketplace-catalog.js';

export type MarketplaceUnavailableReason =
  | 'unknown'
  | 'not_installed'
  | 'not_active'
  | 'not_enabled';

export type MarketplaceResolution =
  | { ok: true; plugin: schema.Plugin; info: MarketplaceInfo }
  | { ok: false; reason: MarketplaceUnavailableReason; info?: MarketplaceInfo };

export function unavailableMessage(code: string, reason: MarketplaceUnavailableReason): string {
  switch (reason) {
    case 'unknown':
      return `marketplace ${code} este necunoscut`;
    case 'not_installed':
      return `pluginul pentru ${code} nu este instalat`;
    case 'not_active':
      return `pluginul pentru ${code} nu este activ`;
    case 'not_enabled':
      return `marketplace ${code} nu este activat — activează-l în setările plugin-ului`;
  }
}

const RESOLVE_TTL_MS = 5000;

interface CacheEntry {
  value: MarketplaceResolution;
  expiresAt: number;
}

@Injectable()
export class MarketplaceEnablementService {
  private readonly resolveCache = new Map<string, CacheEntry>();

  constructor(private readonly registry: PluginRegistryService) {}

  isEnabled(plugin: schema.Plugin, code: string): boolean {
    return (plugin.config.enabledMarketplaces ?? []).includes(code);
  }

  clearResolveCache(): void {
    this.resolveCache.clear();
  }

  async resolve(code: string): Promise<MarketplaceResolution> {
    const now = Date.now();
    const cached = this.resolveCache.get(code);
    if (cached !== undefined && now < cached.expiresAt) {
      return cached.value;
    }

    const info = getMarketplace(code);
    if (!info) {
      const value: MarketplaceResolution = { ok: false, reason: 'unknown' };
      this.resolveCache.set(code, { value, expiresAt: now + RESOLVE_TTL_MS });
      return value;
    }

    const plugin = await this.registry.findByPackageName(info.pluginPackage);
    if (!plugin) {
      const value: MarketplaceResolution = { ok: false, reason: 'not_installed', info };
      this.resolveCache.set(code, { value, expiresAt: now + RESOLVE_TTL_MS });
      return value;
    }
    if (plugin.status !== 'active') {
      const value: MarketplaceResolution = { ok: false, reason: 'not_active', info };
      this.resolveCache.set(code, { value, expiresAt: now + RESOLVE_TTL_MS });
      return value;
    }
    if (!this.isEnabled(plugin, code)) {
      const value: MarketplaceResolution = { ok: false, reason: 'not_enabled', info };
      this.resolveCache.set(code, { value, expiresAt: now + RESOLVE_TTL_MS });
      return value;
    }

    const value: MarketplaceResolution = { ok: true, plugin, info };
    this.resolveCache.set(code, { value, expiresAt: now + RESOLVE_TTL_MS });
    return value;
  }
}
