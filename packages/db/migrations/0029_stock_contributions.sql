CREATE TABLE IF NOT EXISTS "stock_contributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"source_order_id" text NOT NULL,
	"quantity_applied" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_contributions" ADD CONSTRAINT "stock_contributions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_contributions_sku_source_order_unique" ON "stock_contributions" USING btree ("sku","source_order_id");
