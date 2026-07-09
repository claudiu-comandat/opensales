import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { createDb } from '../client.js';
import { users } from '../schema/users.js';

export interface SeedAdminInput {
  databaseUrl: string;
  email: string;
  password: string;
}

export interface SeedAdminResult {
  created: boolean;
  email: string;
}

export async function seedAdmin(input: SeedAdminInput): Promise<SeedAdminResult> {
  if (input.password.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }
  const { db, close } = createDb(input.databaseUrl, { max: 1 });
  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${input.email})`);
    if (existing.length > 0) {
      return { created: false, email: input.email };
    }
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
    });
    await db.insert(users).values({
      id: uuidv7(),
      email: input.email,
      passwordHash,
      role: 'admin',
      isActive: true,
    });
    return { created: true, email: input.email };
  } finally {
    await close();
  }
}

if (process.argv[1]?.endsWith('admin.ts') || process.argv[1]?.endsWith('admin.js')) {
  const databaseUrl = process.env.DATABASE_URL;
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!databaseUrl || !email || !password) {
    console.error('DATABASE_URL, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD required');
    process.exit(1);
  }
  seedAdmin({ databaseUrl, email, password })
    .then((res) => {
      // eslint-disable-next-line no-console
      console.log(
        res.created ? `Admin '${res.email}' created.` : `Admin '${res.email}' already exists.`,
      );
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
