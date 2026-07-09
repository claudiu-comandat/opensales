ALTER TABLE products ADD COLUMN stock_zero_since timestamptz;

-- Backfill: produsele cu stoc 0 primesc updated_at ca aproximare a momentului când au ajuns la 0
UPDATE products SET stock_zero_since = updated_at WHERE stock_quantity = 0;
