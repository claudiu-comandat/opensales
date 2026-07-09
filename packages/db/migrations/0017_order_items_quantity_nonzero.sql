-- Allow negative quantities on order_items for storno/return lines.
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_quantity_positive";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_nonzero" CHECK ("quantity" <> 0);
