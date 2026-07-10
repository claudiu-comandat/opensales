CREATE TABLE IF NOT EXISTS "order_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_reference" text,
	"fee_amount_minor" bigint,
	"fee_currency" char(3),
	"comment" text,
	"invoice_storno" jsonb,
	"invoice_reissue" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_returns_source_check" CHECK ("order_returns"."source" IN ('emag_rma', 'trendyol_claim', 'manual')),
	CONSTRAINT "order_returns_source_reference_required" CHECK ("order_returns"."source" = 'manual' OR "order_returns"."source_reference" IS NOT NULL),
	CONSTRAINT "order_returns_fee_pairing" CHECK (("order_returns"."fee_amount_minor" IS NULL) = ("order_returns"."fee_currency" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_return_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_return_items_quantity_positive" CHECK ("order_return_items"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_order_return_id_order_returns_id_fk" FOREIGN KEY ("order_return_id") REFERENCES "public"."order_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_returns_order_id_idx" ON "order_returns" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_returns_order_source_reference_unique" ON "order_returns" USING btree ("order_id","source","source_reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_return_items_order_return_id_idx" ON "order_return_items" USING btree ("order_return_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_return_items_order_item_id_idx" ON "order_return_items" USING btree ("order_item_id");
