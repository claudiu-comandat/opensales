import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('postgres://') || u.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// URL',
    }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * Required. 64 hex chars (32 bytes) used to derive per-plugin keys for
   * encrypted secret storage. Set this once and NEVER rotate without first
   * re-configuring all plugin credentials — a different key cannot decrypt
   * the existing ciphertext.
   *
   * Generate one with: `openssl rand -hex 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   */
  PLATFORM_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'PLATFORM_MASTER_KEY must be 64 hex chars (32 bytes)'),
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(12).optional(),
  SESSION_SECRET: z.string().regex(/^[0-9a-fA-F]{64}$/),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  /** Public URL at which the API is reachable from the internet (for webhooks). */
  PUBLIC_API_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  return result.data;
}
