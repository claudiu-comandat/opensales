ALTER TYPE "listing_status" ADD VALUE IF NOT EXISTS 'pending_approval';--> statement-breakpoint
ALTER TYPE "listing_status" ADD VALUE IF NOT EXISTS 'rejected';
