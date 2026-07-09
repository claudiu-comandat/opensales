ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "stock_reserved_non_negative";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "stock_reserved_le_quantity";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN IF EXISTS "stock_reserved";