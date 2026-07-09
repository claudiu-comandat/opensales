import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(
  databaseUrl: string,
  opts: { max?: number } = {},
): {
  db: Database;
  client: ReturnType<typeof postgres>;
  close: () => Promise<void>;
} {
  const client = postgres(databaseUrl, {
    max: opts.max ?? 10,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    close: () => client.end({ timeout: 5 }),
  };
}
