-- Price snapshot per receipt item (mirrors order_items.price pattern)
-- Existing test rows are cleared so the NOT NULL column can be added cleanly.
TRUNCATE receipt_items, receipts RESTART IDENTITY CASCADE;

ALTER TABLE receipt_items
  ADD COLUMN price DECIMAL(15, 2) NOT NULL DEFAULT 0;

ALTER TABLE receipt_items
  ALTER COLUMN price DROP DEFAULT;
