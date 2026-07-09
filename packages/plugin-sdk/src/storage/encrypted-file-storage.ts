import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PluginSecretStorage } from '../context.js';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HKDF_HASH = 'sha256';
const HKDF_SALT = Buffer.from('opensales-plugin-secret-storage');

export interface EncryptedFileStorageOptions {
  masterKeyHex: string;
  pluginName: string;
  dataDir: string;
}

export class EncryptedFileStorage implements PluginSecretStorage {
  private readonly key: Buffer;
  private readonly dir: string;

  constructor(opts: EncryptedFileStorageOptions) {
    if (!/^[0-9a-fA-F]{64}$/.test(opts.masterKeyHex)) {
      throw new Error('masterKeyHex must be 64 hex chars');
    }
    const masterKey = Buffer.from(opts.masterKeyHex, 'hex');
    const derived = hkdfSync(
      HKDF_HASH,
      masterKey,
      HKDF_SALT,
      Buffer.from(opts.pluginName),
      KEY_LEN,
    );
    this.key = Buffer.from(derived);
    this.dir = opts.dataDir;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const path = this.pathFor(key);
    if (!existsSync(path)) return null;
    const raw = await readFile(path);
    const decoded = Buffer.from(raw.toString('utf8'), 'base64');
    if (decoded.length < IV_LEN + TAG_LEN) {
      throw new Error(`Corrupt secret file: ${key}`);
    }
    const iv = decoded.subarray(0, IV_LEN);
    const tag = decoded.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = decoded.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALG, this.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.assertKey(key);
    await mkdir(this.dir, { recursive: true });
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, tag, ciphertext]).toString('base64');
    await writeFile(this.pathFor(key), blob, { mode: 0o600 });
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    const path = this.pathFor(key);
    if (existsSync(path)) {
      await rm(path);
    }
  }

  async list(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    const entries = await readdir(this.dir);
    return entries.filter((f) => f.endsWith('.enc')).map((f) => f.slice(0, -4));
  }

  private pathFor(key: string): string {
    this.assertKey(key);
    return join(this.dir, `${key}.enc`);
  }

  private assertKey(key: string): void {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
  }
}
