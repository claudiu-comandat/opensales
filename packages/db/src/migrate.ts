import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Resolve migrations folder relative to THIS file so the script works
// regardless of cwd (dev cwd = packages/db; container cwd = /app).
const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(here, '..', 'migrations');

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

/* eslint-disable no-console */

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

function readJournalTags(): string[] {
  const journalPath = resolve(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  if (!existsSync(journalPath)) return [];
  const parsed = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries?: JournalEntry[] };
  return (parsed.entries ?? []).map((e) => e.tag);
}

/**
 * Reimplementare a `drizzle-orm`'s `migrate()` care aplică fiecare migrare în
 * PROPRIA tranzacție, nu pe toate cele pending într-una singură. Motivul:
 * `migrate()` original bagă tot batch-ul pending într-o singură tranzacție, iar
 * `ALTER TYPE ... ADD VALUE` dintr-o migrare + folosirea acelei valori într-o
 * migrare ulterioară (ex. 0016 + 0026) nu pot coexista în aceeași tranzacție —
 * Postgres respinge cu „unsafe use of new value" până la commit. Pe o bază nouă
 * (CI, disaster recovery) asta pica migrate() garantat. Bookkeeping-ul (schema
 * `drizzle`, tabela `__drizzle_migrations`, coloanele hash/created_at) rămâne
 * identic cu al lui drizzle, ca să citească/scrie compatibil cu ce e deja în producție.
 */
async function runMigrations(db: PostgresJsDatabase, migrationsFolder: string): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  const dbMigrations = await db.execute<{ created_at: string }>(
    sql`select created_at from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} order by created_at desc limit 1`,
  );
  const lastAppliedMillis = dbMigrations[0] ? Number(dbMigrations[0].created_at) : undefined;

  const migrations = readMigrationFiles({ migrationsFolder });
  for (const migration of migrations) {
    if (lastAppliedMillis !== undefined && lastAppliedMillis >= migration.folderMillis) continue;
    await db.transaction(async (tx) => {
      for (const stmt of migration.sql) {
        await tx.execute(sql.raw(stmt));
      }
      await tx.execute(
        sql`insert into ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") values (${migration.hash}, ${migration.folderMillis})`,
      );
    });
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing');
    process.exit(1);
  }
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client);

  const tags = readJournalTags();
  console.log(
    `[migrate] folder=${MIGRATIONS_FOLDER} exists=${existsSync(MIGRATIONS_FOLDER)} ` +
      `journalEntries=${tags.length} last=${tags.slice(-3).join(',')}`,
  );

  await runMigrations(db, MIGRATIONS_FOLDER);

  // Diagnostics — prove what the DB recorded and whether the column landed.
  const applied = await db.execute(
    sql`select count(*)::int as count, coalesce(max(created_at), 0)::text as max_created_at from drizzle.__drizzle_migrations`,
  );
  const stockCol = await db.execute(
    sql`select 1 from information_schema.columns where table_name = 'products' and column_name = 'stock_code' limit 1`,
  );
  console.log(
    `[migrate] applied=${JSON.stringify(applied[0] ?? {})} ` +
      `products.stock_code_present=${stockCol.length > 0}`,
  );
  if (stockCol.length === 0) {
    console.error(
      '[migrate] FATAL: products.stock_code still missing after migrate run. ' +
        'Check drizzle.__drizzle_migrations — 0013_force_stock_code must be applied.',
    );
    await client.end({ timeout: 5 });
    process.exit(1);
  }

  console.log('Migrations applied.');
  await client.end({ timeout: 5 });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
