-- ============================================================
-- 01 — Weighted-average cost tracking on inventory
-- ============================================================
-- Before this migration, cost was a single global value on products.cost_price,
-- snapshotted into order_items/receipt_items at transaction time. That can't
-- represent stock acquired at different costs: adding a new batch either
-- overwrote the product cost (distorting profit on units already in stock) or
-- was simply ignored.
--
-- avg_cost is the moving-average unit cost of the stock currently held in a
-- given (shop, product) inventory row. It is recomputed on every cost-bearing
-- stock-in (manual stockIn, or an order received from the warehouse):
--
--   new_avg = (old_qty * old_avg + add_qty * add_cost) / (old_qty + add_qty)
--
-- Removing stock (sales, negative adjustments) never changes it — the unit cost
-- of the remaining units is unchanged by definition.
--
-- Stored at 4 decimals on purpose: avg_cost is a cost *basis/rate*, not a
-- settled money amount, and the moving average feeds back into itself, so
-- rounding error would compound across blends and permanently bias reported
-- profit. Settled amounts (price columns, receipt/order totals) stay at 2 dp.

ALTER TABLE inventory
  ADD COLUMN avg_cost DECIMAL(10, 4) NOT NULL DEFAULT 0;

-- Backfill existing rows from the product's current cost_price — the single
-- global basis that was in effect before this change.
UPDATE inventory i
SET avg_cost = p.cost_price
FROM products p
WHERE p.id = i.product_id;

-- The per-line cost snapshots now carry the (4 dp) moving average forward into
-- each transaction. Widen them so we don't re-round at the snapshot boundary.
-- price columns are left at 2 dp — they are settled selling amounts.
ALTER TABLE order_items   ALTER COLUMN cost_price TYPE DECIMAL(15, 4);
ALTER TABLE receipt_items ALTER COLUMN cost_price TYPE DECIMAL(15, 4);
