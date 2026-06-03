-- ============================================================
-- Migration 05: Align schema with Central Warehouse business model
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Update users role constraint
-- ------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('WAREHOUSE_ADMIN', 'SHOP_OWNER', 'EMPLOYEE'));

-- ------------------------------------------------------------
-- 2. Add shop type column
-- ------------------------------------------------------------
ALTER TABLE shops
  ADD COLUMN type VARCHAR(50)
    NOT NULL DEFAULT 'SHOP'
    CHECK (type IN ('WAREHOUSE', 'SHOP'));

-- ------------------------------------------------------------
-- 3. Update orders table: replace shop_id with from/to FKs
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_orders_shop_id;
ALTER TABLE orders DROP COLUMN IF EXISTS shop_id;

ALTER TABLE orders
  ADD COLUMN from_shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
  ADD COLUMN to_shop_id   INTEGER REFERENCES shops(id) ON DELETE CASCADE;

CREATE INDEX idx_orders_from_shop_id ON orders(from_shop_id);
CREATE INDEX idx_orders_to_shop_id   ON orders(to_shop_id);

-- ------------------------------------------------------------
-- 4. Seed: insert the central warehouse
-- ------------------------------------------------------------
INSERT INTO shops (name, address, type)
VALUES ('Main Warehouse', 'Central Location', 'WAREHOUSE');

COMMIT;
