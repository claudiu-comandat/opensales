ALTER TABLE "order_items"
  ADD COLUMN "original_sku" text,
  ADD COLUMN "original_name" text,
  ADD COLUMN "original_product_id" uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN "substituted_at" timestamp with time zone;
