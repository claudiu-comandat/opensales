ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "platform" text NOT NULL DEFAULT '';--> statement-breakpoint
DROP INDEX IF EXISTS "listings_product_plugin_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listings_product_plugin_platform_unique" ON "listings" ("product_id","plugin_id","platform");
