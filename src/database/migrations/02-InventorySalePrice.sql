-- ============================================================
-- 02 — Per-shop selling price on inventory
-- ============================================================
-- Selling price had the same problem cost did (see 01): products.price is a
-- single global value shared across every shop that stocks a warehouse product,
-- so a shop owner could not set their own retail price without changing it for
-- everyone. sale_price moves the selling price onto the inventory row — one per
-- (shop, product) — so each shop sets its own price.
--
-- products.price stays as the warehouse list / default price. inventory.sale_price
-- is seeded from it the first time a row is created (see upsertStockIn) and is
-- never overwritten by later stock-ins, so a shop owner's chosen price sticks.
-- A sale snapshots sale_price into receipt_items.price.
--
-- 2 dp: unlike avg_cost, sale_price is a settled selling amount, so it matches
-- the precision of the price columns it feeds.

ALTER TABLE inventory
  ADD COLUMN sale_price DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Backfill existing rows from the product's current price.
UPDATE inventory i
SET sale_price = p.price
FROM products p
WHERE p.id = i.product_id;
