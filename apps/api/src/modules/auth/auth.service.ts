import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';

import { DomainError } from '../../errors/domain.error.js';

@Injectable()
export class AuthService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  async verifyCredentials(email: string, password: string): Promise<schema.User> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(
        sql`lower(${schema.users.email}) = lower(${email}) AND ${schema.users.isActive} = true`,
      )
      .limit(1);
    const user = rows[0];
    if (!user) {
      throw DomainError.unauthorized('Invalid credentials');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw DomainError.unauthorized('Invalid credentials');
    }
    await this.db
      .update(schema.users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));
    return user;
  }
}
