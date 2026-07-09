import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { DomainError } from '../../../errors/domain.error.js';

import { PluginPermissionsCache } from './permissions-cache.js';

export type PluginStatus = 'pending_verification' | 'active' | 'error' | 'disabled';

type DbPlugin = schema.Plugin;
type NewPlugin = schema.NewPlugin;

@Injectable()
export class PluginRegistryService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly permsCache: PluginPermissionsCache,
  ) {}

  async create(input: Omit<NewPlugin, 'id'>): Promise<DbPlugin> {
    const id = uuidv7();
    const [row] = await this.db
      .insert(schema.plugins)
      .values({ ...input, id })
      .returning();
    if (!row) throw DomainError.conflict('Plugin insert returned no row');
    this.permsCache.set(id, row.grantedPermissions);
    return row;
  }

  async findById(id: string): Promise<DbPlugin | null> {
    const rows = await this.db
      .select()
      .from(schema.plugins)
      .where(eq(schema.plugins.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByPackageName(name: string): Promise<DbPlugin | null> {
    const rows = await this.db
      .select()
      .from(schema.plugins)
      .where(eq(schema.plugins.packageName, name))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(filter: { status?: PluginStatus } = {}): Promise<DbPlugin[]> {
    if (filter.status) {
      return this.db.select().from(schema.plugins).where(eq(schema.plugins.status, filter.status));
    }
    return this.db.select().from(schema.plugins);
  }

  async updateStatus(id: string, status: PluginStatus, lastError?: string | null): Promise<void> {
    const setHealthCheck = status === 'active' || status === 'error';
    const updateValues: Partial<NewPlugin> = {
      status,
      lastError: lastError ?? null,
      updatedAt: new Date(),
    };
    if (setHealthCheck) {
      updateValues.lastHealthCheckAt = new Date();
    }
    await this.db.update(schema.plugins).set(updateValues).where(eq(schema.plugins.id, id));
  }

  async updateGrantedPermissions(id: string, perms: string[]): Promise<void> {
    await this.db
      .update(schema.plugins)
      .set({ grantedPermissions: perms, updatedAt: new Date() })
      .where(eq(schema.plugins.id, id));
    this.permsCache.set(id, perms);
  }

  async updateConfig(id: string, config: Record<string, unknown>): Promise<void> {
    await this.db
      .update(schema.plugins)
      .set({ config, updatedAt: new Date() })
      .where(eq(schema.plugins.id, id));
  }

  async hasPermission(pluginId: string, perm: string): Promise<boolean> {
    const cached = this.permsCache.has(pluginId, perm);
    if (cached !== null) return cached;
    const row = await this.findById(pluginId);
    if (!row) return false;
    this.permsCache.set(pluginId, row.grantedPermissions);
    return row.grantedPermissions.includes(perm);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(schema.plugins).where(eq(schema.plugins.id, id));
    this.permsCache.invalidate(id);
  }
}
