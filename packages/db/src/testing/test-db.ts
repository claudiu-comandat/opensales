import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createDb, type Database } from '../client.js';
import * as allSchema from '../schema/index.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

const DEFAULT_TEST_URL = 'postgres://opensales:opensales@localhost:5433/opensales_test';

let migrationsApplied = false;

export interface TestDbHandle {
  db: Database;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function setupTestDb(
  opts: { url?: string | undefined; runMigrations?: boolean | undefined } = {},
): Promise<TestDbHandle> {
  const url = opts.url ?? process.env.DATABASE_URL_TEST ?? DEFAULT_TEST_URL;
  const { db, close } = createDb(url, { max: 4 });

  if ((opts.runMigrations ?? true) && !migrationsApplied) {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    migrationsApplied = true;
  }

  const tableNames = Object.values(allSchema)
    .filter(isPgTable)
    .map((t) => `"${getTableConfig(t as Parameters<typeof getTableConfig>[0]).name}"`)
    .join(', ');

  return {
    db,
    close,
    reset: async () => {
      if (tableNames.length > 0) {
        await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`));
      }
    },
  };
}

function isPgTable(v: unknown): boolean {
  return typeof v === 'object' && v !== null && Symbol.for('drizzle:IsDrizzleTable') in v;
}

export async function withRollback<T>(db: Database, fn: (tx: Database) => Promise<T>): Promise<T> {
  let captured: T | undefined;
  let resolved = false;
  try {
    await db.transaction(async (tx) => {
      captured = await fn(tx as unknown as Database);
      resolved = true;
      throw new RollbackSignal();
    });
  } catch (err) {
    if (!(err instanceof RollbackSignal)) throw err;
  }
  if (!resolved) throw new Error('withRollback: fn did not resolve');
  return captured as T;
}

class RollbackSignal extends Error {
  constructor() {
    super('rollback');
  }
}
