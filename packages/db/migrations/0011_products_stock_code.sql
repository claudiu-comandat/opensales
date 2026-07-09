ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_code" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_stock_code_unique" ON "products" USING btree ("stock_code") WHERE "stock_code" IS NOT NULL;
