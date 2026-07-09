ALTER TABLE "plugins" ADD COLUMN "encrypted_secrets" jsonb NOT NULL DEFAULT '{}'::jsonb;
