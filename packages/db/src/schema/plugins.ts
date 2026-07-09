import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const pluginStatusEnum = pgEnum('plugin_status', [
  'pending_verification',
  'active',
  'error',
  'disabled',
]);

export interface PluginManifest {
  name: string;
  version: string;
  displayName?: string | undefined;
  description?: string | undefined;
  type?: string | undefined;
  permissions: string[];
  configSchema?: unknown;
  secretSchema?: unknown;
  capabilities?: string[] | undefined;
  logoDataUri?: string | undefined;
}

export interface PluginConfig {
  enabledMarketplaces?: string[] | undefined;
  /** Trendyol: Easy Cross Country activ — celelalte țări se sincronizează din RO. */
  trendyolEasyCrossCountry?: boolean | undefined;
  [key: string]: unknown;
}

export const plugins = pgTable(
  'plugins',
  {
    id: uuid('id').primaryKey().notNull(),
    packageName: text('package_name').notNull(),
    version: text('version').notNull(),
    displayName: text('display_name').notNull(),
    manifest: jsonb('manifest').$type<PluginManifest>().notNull(),
    config: jsonb('config')
      .$type<PluginConfig>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    encryptedSecrets: jsonb('encrypted_secrets')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    grantedPermissions: jsonb('granted_permissions')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: pluginStatusEnum('status').notNull().default('pending_verification'),
    hash: text('hash').notNull(),
    lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
    lastError: text('last_error'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    packageNameUnique: uniqueIndex('plugins_package_name_unique').on(t.packageName),
    statusIdx: index('plugins_status_idx').on(t.status),
  }),
);

export type Plugin = typeof plugins.$inferSelect;
export type NewPlugin = typeof plugins.$inferInsert;
