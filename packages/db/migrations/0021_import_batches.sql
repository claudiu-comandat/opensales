CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"total_products" integer NOT NULL,
	"processed_products" integer DEFAULT 0 NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_status_idx" ON "import_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_created_at_idx" ON "import_batches" USING btree ("created_at");
