import semver from 'semver';
import { z } from 'zod';

import { actionDefinitionShape } from './actions.js';
import { PLATFORM_EVENTS } from './events.js';
import { PERMISSIONS, type Permission } from './permissions.js';

/**
 * Plugin types — primele 3 au UI dedicat în admin; restul sunt afișate generic.
 */
export const PRINCIPAL_TYPES = ['marketplace', 'shipping', 'invoicing'] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const pluginTypeSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'type must be lowercase kebab-case');

export const pluginCapabilitySchema = z.enum(['marketplace', 'shipping', 'invoicing', 'utility']);
export type PluginCapability = z.infer<typeof pluginCapabilitySchema>;

const platformEventEnum = z.enum(PLATFORM_EVENTS as unknown as [string, ...string[]]);

export const pluginManifestSchema = z.object({
  packageName: z
    .string()
    .regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/, 'packageName must be a scoped npm name'),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/, 'semver required'),
  displayName: z.string().min(1),
  description: z.string().optional(),

  type: pluginTypeSchema,

  /**
   * SemVer range against platform version (e.g. "^0.1.0", ">=0.1 <1.0").
   * Validat la runtime cu `semver` library.
   */
  platformVersion: z.string().min(1),

  capabilities: z.array(pluginCapabilitySchema).min(1),

  permissions: z.array(z.enum(PERMISSIONS as unknown as [Permission, ...Permission[]])).default([]),

  /** Acțiuni expuse de plugin către platformă. */
  actions: z.record(actionDefinitionShape).optional().default({}),

  /** Evenimente la care plugin-ul se abonează. */
  events: z.array(platformEventEnum).optional().default([]),

  /**
   * Schemele de secret și config sunt reprezentate ca obiecte serializabile.
   * UI-ul folosește acestea pentru a genera formulare.
   * Format recomandat: JSON Schema-like.
   */
  secretSchema: z.unknown().optional(),
  configSchema: z.unknown().optional(),

  entrypoint: z.string().default('./dist/index.js'),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function parseManifest(input: unknown): PluginManifest {
  const result = pluginManifestSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid plugin manifest: ${detail}`);
  }
  return result.data;
}

export function isPlatformVersionCompatible(
  manifestRange: string,
  platformVersion: string,
): boolean {
  return semver.satisfies(platformVersion, manifestRange);
}
