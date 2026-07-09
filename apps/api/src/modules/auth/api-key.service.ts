import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { DomainError } from '../../errors/domain.error.js';

export interface ApiKeyContext {
  keyId: string;
  userId: string;
  scopes: string[];
}

@Injectable()
export class ApiKeyService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  async findActive(rawKey: string): Promise<ApiKeyContext | null> {
    if (!rawKey.startsWith('ops_')) return null;
    const tokenHash = this.hashKey(rawKey);
    const rows = await this.db
      .select()
      .from(schema.apiKeys)
      .where(
        sql`${schema.apiKeys.keyHash} = ${tokenHash}
            AND ${schema.apiKeys.revokedAt} IS NULL
            AND (${schema.apiKeys.expiresAt} IS NULL OR ${schema.apiKeys.expiresAt} > now())`,
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    void this.touch(row.id);
    return { keyId: row.id, userId: row.userId, scopes: row.scopes };
  }

  private async touch(id: string): Promise<void> {
    await this.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.apiKeys.id, id));
  }

  private generateRaw(): { raw: string; hash: string; prefix: string } {
    const token = randomBytes(24).toString('base64url');
    const raw = `ops_${token}`;
    return { raw, hash: this.hashKey(raw), prefix: raw.slice(0, 12) };
  }

  /** Toate cheile active (nerevoce) ale unui utilizator. */
  async listForUser(userId: string): Promise<schema.ApiKey[]> {
    return this.db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.revokedAt)))
      .orderBy(desc(schema.apiKeys.createdAt));
  }

  /** Creează o cheie nouă pentru utilizator. Returnează cheia raw (o singură dată). */
  async createForUser(
    userId: string,
    name: string,
  ): Promise<{ key: schema.ApiKey; rawKey: string }> {
    const { raw, hash, prefix } = this.generateRaw();
    const rows = await this.db
      .insert(schema.apiKeys)
      .values({
        id: uuidv7(),
        userId,
        name,
        keyHash: hash,
        keyPrefix: prefix,
        scopes: [
          'orders:read',
          'orders:write',
          'orders:status:write',
          'awb:emit',
          'products:write',
          'invoice:emit',
        ],
      })
      .returning();
    const key = rows[0];
    if (!key) throw DomainError.conflict('Failed to create API key');
    return { key, rawKey: raw };
  }

  /**
   * Revocă cheia curentă și creează una nouă cu același nume și scopuri.
   * Returnează cheia raw a celei noi (o singură dată).
   */
  async rotateKey(keyId: string, userId: string): Promise<{ key: schema.ApiKey; rawKey: string }> {
    const rows = await this.db
      .select()
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.id, keyId),
          eq(schema.apiKeys.userId, userId),
          isNull(schema.apiKeys.revokedAt),
        ),
      )
      .limit(1);
    const current = rows[0];
    if (!current) throw DomainError.notFound('API key not found');

    await this.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.apiKeys.id, keyId));

    const { raw, hash, prefix } = this.generateRaw();
    const newRows = await this.db
      .insert(schema.apiKeys)
      .values({
        id: uuidv7(),
        userId,
        name: current.name,
        keyHash: hash,
        keyPrefix: prefix,
        scopes: current.scopes,
      })
      .returning();
    const key = newRows[0];
    if (!key) throw DomainError.conflict('Failed to create rotated API key');
    return { key, rawKey: raw };
  }
}
