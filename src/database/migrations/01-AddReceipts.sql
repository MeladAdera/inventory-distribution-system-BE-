-- RECEIPTS
CREATE TABLE receipts (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER NOT NULL REFERENCES shops(id)  ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_shop_created ON receipts(shop_id, created_at DESC);
CREATE INDEX idx_receipts_created_by  ON receipts(created_by);

-- RECEIPT ITEMS
CREATE TABLE receipt_items (
  id              SERIAL PRIMARY KEY,
  receipt_id      INTEGER NOT NULL REFERENCES receipts(id)   ON DELETE CASCADE,
  inventory_id    INTEGER NOT NULL REFERENCES inventory(id)  ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  quantity_before INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL CHECK (quantity_after >= 0)
);

CREATE INDEX idx_receipt_items_receipt_id   ON receipt_items(receipt_id);
CREATE INDEX idx_receipt_items_inventory_id ON receipt_items(inventory_id);
