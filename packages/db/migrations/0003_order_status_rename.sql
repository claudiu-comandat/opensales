-- Rename order_status enum values: acknowledged→processing, preparing→packed
ALTER TYPE order_status RENAME VALUE 'acknowledged' TO 'processing';
ALTER TYPE order_status RENAME VALUE 'preparing' TO 'packed';
