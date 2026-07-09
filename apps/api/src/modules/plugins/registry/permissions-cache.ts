import { Injectable } from '@nestjs/common';

@Injectable()
export class PluginPermissionsCache {
  private readonly cache = new Map<string, Set<string>>();

  set(pluginId: string, perms: string[]): void {
    this.cache.set(pluginId, new Set(perms));
  }

  invalidate(pluginId: string): void {
    this.cache.delete(pluginId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  has(pluginId: string, perm: string): boolean | null {
    const set = this.cache.get(pluginId);
    if (!set) return null;
    return set.has(perm);
  }
}
