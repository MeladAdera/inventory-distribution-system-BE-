-- ============================================================
-- EXTERNAL SUPPLIER DEBT (accounts payable)
--
-- A shop — or the warehouse itself, which is just another shops row — buys from
-- an outside supplier, pays part of the invoice and owes the rest. There is no
-- order and no receipt behind it: the user types the invoice total and what was
-- handed over, so `debts` gains a third shape with no source document.
--
-- This reuses `debts` rather than a parallel payables table so that one ledger,
-- one payment engine and one reversal rule serve both directions. The cost is
-- that every receivables query must now say which side of the ledger it means —
-- the 3-arm shape constraint below is what makes "which side" always answerable
-- from the row itself.
-- ============================================================

-- SUPPLIERS
-- Deliberately shaped exactly like `customers` (03-Debts.sql:27-40): shop-scoped,
-- soft-deleted via is_active, phone unique per shop only while active. The
-- warehouse is a shops row, so the warehouse's own suppliers scope for free.
CREATE TABLE IF NOT EXISTS suppliers (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  phone      VARCHAR(20),
  note       TEXT,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_shop_id ON suppliers(shop_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_phone_shop_unique
  ON suppliers(shop_id, phone) WHERE phone IS NOT NULL AND is_active = TRUE;

-- DEBTS: the payable columns.
--
-- creditor_type defaults to 'SHOP' so every existing row backfills to what it
-- already is — a receivable — with no rewrite (PG 11+ stores a constant default
-- in the catalogue) and no separate UPDATE pass. The default also keeps the
-- currently deployed INSERT (debts.repository.ts:89) valid, so this migration
-- can be applied before the new code ships.
--
-- supplier_id is ON DELETE RESTRICT, matching customers (03-Debts.sql:63):
-- suppliers are soft-deleted, and a hard delete that orphaned payment history
-- would destroy the record of money that actually left the till.
ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS creditor_type VARCHAR(20)  NOT NULL DEFAULT 'SHOP',
  ADD COLUMN IF NOT EXISTS supplier_id   INTEGER      NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS invoice_no    VARCHAR(50)  NULL;

-- A payable is owed TO an outsider, so there is no creditor shop row to point at.
-- Idempotent by nature: DROP NOT NULL on an already-nullable column is a no-op.
ALTER TABLE debts
  ALTER COLUMN creditor_shop_id DROP NOT NULL;

-- Named rather than inlined in ADD COLUMN, so it is addressable by a future
-- DROP CONSTRAINT IF EXISTS. Postgres has no ADD CONSTRAINT IF NOT EXISTS, so
-- DROP-then-ADD is the idempotent form; it is also self-healing, replacing an
-- older definition instead of leaving it in place.
ALTER TABLE debts DROP CONSTRAINT IF EXISTS chk_debts_creditor_type;
ALTER TABLE debts ADD  CONSTRAINT chk_debts_creditor_type
  CHECK (creditor_type IN ('SHOP', 'SUPPLIER'));

-- Replaces chk_debts_debtor_shape (03-Debts.sql:79-87) with the three shapes a
-- debt can now take. Both receivable arms keep creditor_shop_id IS NOT NULL,
-- which is load-bearing: chk_debts_no_self_debt is
-- (debtor_shop_id IS DISTINCT FROM creditor_shop_id), and two NULLs are NOT
-- distinct — a receivable with no creditor would fail that check with a
-- completely misleading error.
--
-- The supplier arm pins order_id and receipt_id to NULL, which is what keeps
-- payables out of idx_debts_order_unique / idx_debts_receipt_unique and out of
-- every findBySource query.
ALTER TABLE debts DROP CONSTRAINT IF EXISTS chk_debts_debtor_shape;
ALTER TABLE debts DROP CONSTRAINT IF EXISTS chk_debts_party_shape;
ALTER TABLE debts ADD  CONSTRAINT chk_debts_party_shape CHECK (
  -- 1. Receivable from an order: warehouse -> shop.
  (creditor_type = 'SHOP' AND debtor_type = 'SHOP'
     AND creditor_shop_id IS NOT NULL AND supplier_id IS NULL AND invoice_no IS NULL
     AND debtor_shop_id   IS NOT NULL AND customer_id IS NULL
     AND order_id         IS NOT NULL AND receipt_id  IS NULL)
  OR
  -- 2. Receivable from a receipt: shop -> customer.
  (creditor_type = 'SHOP' AND debtor_type = 'CUSTOMER'
     AND creditor_shop_id IS NOT NULL AND supplier_id IS NULL AND invoice_no IS NULL
     AND customer_id      IS NOT NULL AND debtor_shop_id IS NULL
     AND receipt_id       IS NOT NULL AND order_id       IS NULL)
  OR
  -- 3. Payable to an outside supplier. No source document exists, so both
  --    source columns must be NULL — that absence is the arm's signature.
  (creditor_type = 'SUPPLIER' AND debtor_type = 'SHOP'
     AND creditor_shop_id IS NULL     AND supplier_id    IS NOT NULL
     AND debtor_shop_id   IS NOT NULL AND customer_id    IS NULL
     AND order_id         IS NULL     AND receipt_id     IS NULL)
);

-- "What do I owe this supplier" — the payables mirror of idx_debts_customer.
CREATE INDEX IF NOT EXISTS idx_debts_supplier
  ON debts(supplier_id) WHERE supplier_id IS NOT NULL;

-- Serves getSummaryForShopAs('DEBTOR'), which must now split by ledger side:
-- a shop's debt to the warehouse and its debt to suppliers are different money.
CREATE INDEX IF NOT EXISTS idx_debts_debtor_shop_creditor_type
  ON debts(debtor_shop_id, creditor_type) WHERE debtor_shop_id IS NOT NULL;

-- A payable has no source document, so nothing else stops the same invoice
-- being keyed in twice. The invoice number is the closest thing it has to one,
-- so it gets the same "one live debt per source" rule as orders and receipts
-- (03-Debts.sql:98-101), scoped to non-CANCELLED for the same reason. Only
-- applies when an invoice number was actually given.
CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_supplier_invoice_unique
  ON debts(supplier_id, invoice_no)
  WHERE supplier_id IS NOT NULL AND invoice_no IS NOT NULL AND status <> 'CANCELLED';
