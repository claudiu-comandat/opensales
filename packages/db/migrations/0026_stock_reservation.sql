ALTER TABLE products ADD COLUMN stock_reserved integer NOT NULL DEFAULT 0;
ALTER TABLE products ADD CONSTRAINT products_stock_reserved_nonneg CHECK (stock_reserved >= 0);

ALTER TABLE orders ADD COLUMN stock_reservation_claimed boolean NOT NULL DEFAULT false;

-- Backfill: marchează comenzile active existente (nefacturate) ca rezervate
UPDATE orders
SET stock_reservation_claimed = true
WHERE status IN ('new', 'processing', 'packed', 'shipped', 'undelivered')
  AND (invoice IS NULL OR (invoice->>'status') IS DISTINCT FROM 'issued');

-- Calculează stock_reserved actual din comenzile active
UPDATE products p
SET stock_reserved = COALESCE((
  SELECT SUM(oi.quantity)
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = p.id AND o.stock_reservation_claimed = true
), 0);
