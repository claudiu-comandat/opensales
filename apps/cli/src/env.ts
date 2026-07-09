/**
 * Loads required environment variables for the CLI.
 *
 * The actual loading happens via `tsx --env-file=../../.env` in dev mode and
 * via the host shell when running the compiled binary. This module simply
 * surfaces the values in a typed shape and validates presence on demand.
 */

export interface CliEnv {
  databaseUrl: string;
  nodeEnv: string;
}

export function loadEnv(): CliEnv {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Did you forget to load the .env file?');
  }
  return {
    databaseUrl,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}
