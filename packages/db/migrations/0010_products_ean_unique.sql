CREATE UNIQUE INDEX IF NOT EXISTS "products_ean_unique" ON "products" USING btree ("ean") WHERE "ean" IS NOT NULL;
