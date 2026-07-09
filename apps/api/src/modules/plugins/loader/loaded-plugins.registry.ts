import { Injectable } from '@nestjs/common';

import type { LoadedPlugin } from '../types.js';

@Injectable()
export class LoadedPluginsRegistry {
  private readonly byId = new Map<string, LoadedPlugin>();
  private readonly byPackage = new Map<string, LoadedPlugin>();

  register(p: LoadedPlugin): void {
    this.byId.set(p.pluginId, p);
    this.byPackage.set(p.packageName, p);
  }

  unregister(pluginId: string): LoadedPlugin | null {
    const p = this.byId.get(pluginId);
    if (!p) return null;
    this.byId.delete(pluginId);
    this.byPackage.delete(p.packageName);
    return p;
  }

  getById(id: string): LoadedPlugin | null {
    return this.byId.get(id) ?? null;
  }

  getByPackage(name: string): LoadedPlugin | null {
    return this.byPackage.get(name) ?? null;
  }

  list(): LoadedPlugin[] {
    return Array.from(this.byId.values());
  }
}
