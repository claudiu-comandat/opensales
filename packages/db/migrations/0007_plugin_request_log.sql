CREATE TABLE IF NOT EXISTS "plugin_request_log" (
  "id" uuid PRIMARY KEY NOT NULL,
  "plugin_id" uuid NOT NULL REFERENCES "plugins"("id") ON DELETE CASCADE,
  "method" text NOT NULL,
  "url" text NOT NULL,
  "path" text NOT NULL,
  "request_body" jsonb,
  "request_headers" jsonb,
  "status" integer,
  "response_body" jsonb,
  "response_size_bytes" bigint,
  "duration_ms" integer,
  "error" text,
  "correlation" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_request_log_plugin_idx" ON "plugin_request_log" ("plugin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_request_log_path_idx" ON "plugin_request_log" ("path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_request_log_created_at_idx" ON "plugin_request_log" ("created_at");
