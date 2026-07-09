ALTER TABLE "plugins" ADD COLUMN IF NOT EXISTS "encrypted_secrets" jsonb NOT NULL DEFAULT '{}'::jsonb;
