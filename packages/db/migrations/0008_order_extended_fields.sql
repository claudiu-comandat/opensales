ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_cost_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "vouchers_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refunded_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_location" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "attachments" jsonb;
