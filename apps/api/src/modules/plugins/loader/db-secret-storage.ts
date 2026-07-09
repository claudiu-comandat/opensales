import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { schema } from '@opensales/db';
import { eq } from 'drizzle-orm';

import type { Database } from '@opensales/db';
import type { PluginSecretStorage } from '@opensales/plugin-sdk';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HKDF_HASH = 'sha256';
const HKDF_SALT = Buffer.from('opensales-plugin-secret-storage');

export class DbSecretStorage implements PluginSecretStorage {
  private readonly key: Buffer;

  constructor(
    private readonly db: Database,
    private readonly pluginId: string,
    masterKeyHex: string,
    pluginName: string,
  ) {
    if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
      throw new Error('masterKeyHex must be 64 hex chars');
    }
    const masterKey = Buffer.from(masterKeyHex, 'hex');
    const derived = hkdfSync(HKDF_HASH, masterKey, HKDF_SALT, Buffer.from(pluginName), KEY_LEN);
    this.key = Buffer.from(derived);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    this.assertKey(key);
    const row = await this.db
      .select({ encryptedSecrets: schema.plugins.encryptedSecrets })
      .from(schema.plugins)
      .where(eq(schema.plugins.id, this.pluginId))
      .limit(1);

    const blob = row[0]?.encryptedSecrets?.[key];
    if (!blob) return null;

    try {
      const decoded = Buffer.from(blob, 'base64');
      if (decoded.length < IV_LEN + TAG_LEN) return null;
      const iv = decoded.subarray(0, IV_LEN);
      const tag = decoded.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const ciphertext = decoded.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv(ALG, this.key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8')) as T;
    } catch (err) {
      // Decryption failed despite the ciphertext existing — almost always means
      // PLATFORM_MASTER_KEY changed between writes. Log so the operator can see
      // this in Railway logs and reset credentials instead of silently treating
      // it as "no credentials set".

      console.error(
        `[plugin-secrets] decrypt failed for plugin=${this.pluginId} key=${key}: ${
          err instanceof Error ? err.message : String(err)
        }. Likely PLATFORM_MASTER_KEY rotation — re-configure plugin secrets.`,
      );
      return null;
    }
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.assertKey(key);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, tag, ciphertext]).toString('base64');

    const current = await this.db
      .select({ encryptedSecrets: schema.plugins.encryptedSecrets })
      .from(schema.plugins)
      .where(eq(schema.plugins.id, this.pluginId))
      .limit(1);

    const secrets = { ...(current[0]?.encryptedSecrets ?? {}), [key]: blob };
    await this.db
      .update(schema.plugins)
      .set({ encryptedSecrets: secrets, updatedAt: new Date() })
      .where(eq(schema.plugins.id, this.pluginId));
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    const current = await this.db
      .select({ encryptedSecrets: schema.plugins.encryptedSecrets })
      .from(schema.plugins)
      .where(eq(schema.plugins.id, this.pluginId))
      .limit(1);

    const secrets = { ...(current[0]?.encryptedSecrets ?? {}) };
    delete secrets[key];
    await this.db
      .update(schema.plugins)
      .set({ encryptedSecrets: secrets, updatedAt: new Date() })
      .where(eq(schema.plugins.id, this.pluginId));
  }

  async list(): Promise<string[]> {
    const row = await this.db
      .select({ encryptedSecrets: schema.plugins.encryptedSecrets })
      .from(schema.plugins)
      .where(eq(schema.plugins.id, this.pluginId))
      .limit(1);

    return Object.keys(row[0]?.encryptedSecrets ?? {});
  }

  private assertKey(key: string): void {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
  }
}
