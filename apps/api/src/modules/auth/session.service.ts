import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { ConfigService } from '../../config/config.service.js';

export interface CreatedSession {
  sessionId: string;
  rawToken: string;
  csrfToken: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(input: {
    userId: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<CreatedSession> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const csrfToken = randomBytes(24).toString('hex');
    const ttlMs = this.config.sessionTtlHours * 3600 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);
    const id = uuidv7();

    await this.db.insert(schema.sessions).values({
      id,
      userId: input.userId,
      tokenHash,
      csrfToken,
      expiresAt,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    });

    return { sessionId: id, rawToken, csrfToken, expiresAt };
  }

  async findActive(
    rawToken: string,
  ): Promise<{ session: schema.Session; user: schema.User } | null> {
    const tokenHash = this.hashToken(rawToken);
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(
        sql`${schema.sessions.tokenHash} = ${tokenHash}
            AND ${schema.sessions.revokedAt} IS NULL
            AND ${schema.sessions.expiresAt} > now()
            AND ${schema.users.isActive} = true`,
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { session: row.sessions, user: row.users };
  }

  async touch(sessionId: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ lastActiveAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId));
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId));
  }
}
