-- Add marketplace column to orders for per-country tracking
-- (e.g. 'emag-ro', 'emag-hu', 'trendyol-gr')
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "marketplace" text;
