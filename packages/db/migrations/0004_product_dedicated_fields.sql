ALTER TABLE "products" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ean" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "vat_rate" smallint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "purchase_price_amount_minor" bigint;--> statement-breakpoint
-- Migrate existing EAN values stored in the attributes JSONB to the new dedicated column
UPDATE "products" SET "ean" = "attributes"->>'EAN' WHERE "attributes"->>'EAN' IS NOT NULL AND "attributes"->>'EAN' != '' AND "ean" IS NULL;--> statement-breakpoint
UPDATE "products" SET "ean" = "attributes"->>'ean' WHERE "attributes"->>'ean' IS NOT NULL AND "attributes"->>'ean' != '' AND "ean" IS NULL;
