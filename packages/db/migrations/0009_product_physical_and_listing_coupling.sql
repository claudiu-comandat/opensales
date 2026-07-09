ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "full_price_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "height_mm" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "width_mm" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "length_mm" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "warranty_months" smallint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "handling_time_days" smallint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "number_of_packages" smallint;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "coupled_columns" text[];
