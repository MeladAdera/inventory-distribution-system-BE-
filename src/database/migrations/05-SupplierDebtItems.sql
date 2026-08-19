-- ============================================================
-- SUPPLIER INVOICE LINE ITEMS
--
-- A payable (04-SupplierDebts.sql) records what is owed. This records what was
-- actually bought for that money, so the same POST that raises the bill also
-- puts the goods on the shelf: one transaction, one cost basis, no second trip
-- through the manual stock-in screen.
--
-- Lines are optional. A bill with no items is still a valid payable — plenty of
-- supplier invoices are for services, rent or a delivery charge, and forcing a
-- product onto those would be a lie in the ledger.
-- ============================================================

CREATE TABLE IF NOT EXISTS supplier_debt_items (
  id           SERIAL PRIMARY KEY,
  debt_id      INTEGER NOT NULL REFERENCES debts(id)     ON DELETE CASCADE,
  -- RESTRICT, unlike order_items/receipt_items (00-InitialSchema.sql:138,169).
  -- Those record a movement; this records money that left the till, and the
  -- same reasoning that made debts.supplier_id RESTRICT applies here. Products
  -- are soft-deleted via is_active anyway, so nothing legitimate is blocked.
  product_id   INTEGER NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  -- Which inventory row the units landed in. Mirrors receipt_items.inventory_id
  -- for the outgoing direction, and is what a future cancel-and-restock path
  -- would need in order to take the units back out of the right row.
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  quantity     INTEGER        NOT NULL CHECK (quantity > 0),
  -- The invoice's own unit price. 4 decimals to match inventory.avg_cost, which
  -- this feeds. Strictly positive: a zero-cost line would drag the moving
  -- average down as if the goods were free, and a line that really is free
  -- belongs in a stock adjustment, not on a bill that says what was paid.
  unit_cost    DECIMAL(15, 4) NOT NULL CHECK (unit_cost > 0),
  -- Generated rather than passed in, so the line can never disagree with its
  -- own arithmetic. The service still sums the lines in bigint minor units
  -- before writing, and rejects a total that does not reconcile.
  line_total   DECIMAL(15, 2) GENERATED ALWAYS AS (ROUND(quantity * unit_cost, 2)) STORED,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_debt_items_debt ON supplier_debt_items(debt_id);

-- One line per product per invoice. Two lines for the same product would blend
-- the moving average twice in a row from a stale base, and leave "what did this
-- invoice cost me per unit" with no single answer. The service rejects the
-- duplicate first; this index is the guard against a concurrent insert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_debt_items_debt_product
  ON supplier_debt_items(debt_id, product_id);
