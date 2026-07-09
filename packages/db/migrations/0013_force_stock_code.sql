-- Force-add stock_code column. Previous migrations (0011, 0012) did not land
-- on some environments due to a duplicate journal timestamp on 0010/0011.
-- This migration uses IF NOT EXISTS so it is safe to run on any DB state.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_code" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_stock_code_unique" ON "products" USING btree ("stock_code") WHERE "stock_code" IS NOT NULL;
