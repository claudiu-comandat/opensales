-- Safety net: 0011 did not land on some environments (production crashed with
-- "column stock_code does not exist"). Re-ensure the column + index idempotently
-- with a fresh journal timestamp so the drizzle migrator definitely runs it.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_code" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_stock_code_unique" ON "products" USING btree ("stock_code") WHERE "stock_code" IS NOT NULL;
