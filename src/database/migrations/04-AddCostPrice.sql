-- Buying price (cost) alongside the selling price, for profit tracking.
-- products.cost_price holds the current cost; order_items and receipt_items
-- snapshot it at transaction time (mirrors the existing price-snapshot pattern),
-- so profit on historical transactions is not distorted by later cost changes.
-- Existing rows default to 0 (cost unknown → profit shows full margin).
ALTER TABLE products
  ADD COLUMN cost_price DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE order_items
  ADD COLUMN cost_price DECIMAL(15, 2) NOT NULL DEFAULT 0;

ALTER TABLE receipt_items
  ADD COLUMN cost_price DECIMAL(15, 2) NOT NULL DEFAULT 0;
