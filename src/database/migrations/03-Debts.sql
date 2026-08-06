-- ============================================================
-- DEBTS — deferred payment (accrual basis)
--
-- Two debt flows share one engine:
--   1. warehouse -> shop      : source is an ORDER,   debtor is a shop
--   2. shop      -> customer  : source is a RECEIPT,  debtor is a customer
--
-- Revenue is NOT touched by this feature. Revenue is still recognised when
-- goods move (see analytics.repository.ts). A debt only records money that is
-- owed but not yet collected, so "revenue" and "collected cash" stay separate
-- numbers and no existing profit query changes.
--
-- Money is DECIMAL(15,2) to match order_items/receipt_items. Currency is SYP
-- and single-currency, so no currency column: adding one later would force a
-- backfill decision on every historical row, and there is nothing to decide
-- while only one currency exists.
-- ============================================================

-- CUSTOMERS
-- Deliberately NOT a CRM: only people who buy on deferred payment are stored,
-- so a shop is never forced to register walk-in cash buyers. phone is the
-- identity key (unique per shop) — names collide constantly in practice, so
-- name is intentionally left non-unique, unlike products.name.
-- Soft-deleted via is_active so a customer with debt history is never lost;
-- the unique index is scoped to is_active = TRUE so deactivating frees the
-- phone number for reuse, mirroring the products barcode/name design.
CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  phone      VARCHAR(20),
  note       TEXT,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_shop_id ON customers(shop_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_shop_unique
  ON customers(shop_id, phone) WHERE phone IS NOT NULL AND is_active = TRUE;

-- DEBTS
-- One row per unpaid order/receipt. total_amount is a SNAPSHOT of the source
-- total taken when the debt is opened — it is never recomputed, so editing or
-- repricing the source later cannot silently change what someone owes.
--
-- paid_amount is denormalised from debt_payments on purpose. The write path
-- locks the debt row (SELECT ... FOR UPDATE) before inserting a payment, so
-- two concurrent collections cannot both pass the "not more than remaining"
-- check; keeping the running total on the locked row makes that check a plain
-- column read instead of a re-aggregation, and makes list/summary queries
-- avoid touching debt_payments at all. debt_payments remains the source of
-- truth — paid_amount must always equal SUM(debt_payments.amount).
--
-- order_id / receipt_id are real FKs rather than a polymorphic
-- (source_type, source_id) pair, so a deleted source can never leave an
-- orphan debt pointing at a dead id. Exactly one of them is set.
CREATE TABLE IF NOT EXISTS debts (
  id               SERIAL PRIMARY KEY,
  creditor_shop_id INTEGER        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  debtor_type      VARCHAR(20)    NOT NULL CHECK (debtor_type IN ('SHOP', 'CUSTOMER')),
  debtor_shop_id   INTEGER        REFERENCES shops(id)     ON DELETE CASCADE,
  customer_id      INTEGER        REFERENCES customers(id) ON DELETE RESTRICT,
  order_id         INTEGER        REFERENCES orders(id)    ON DELETE CASCADE,
  receipt_id       INTEGER        REFERENCES receipts(id)  ON DELETE CASCADE,
  total_amount     DECIMAL(15, 2) NOT NULL CHECK (total_amount > 0),
  paid_amount      DECIMAL(15, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status           VARCHAR(20)    NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN', 'PARTIAL', 'PAID', 'CANCELLED')),
  -- due_date is unused in v1 (no overdue alerts yet); the column exists now so
  -- the aging/reminder work is a code change, not a migration on a live table.
  due_date         DATE,
  note             TEXT,
  created_by       INTEGER        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- A shop debt always comes from an order, a customer debt from a receipt.
  CONSTRAINT chk_debts_debtor_shape CHECK (
    (debtor_type = 'SHOP'
       AND debtor_shop_id IS NOT NULL AND customer_id IS NULL
       AND order_id       IS NOT NULL AND receipt_id  IS NULL)
    OR
    (debtor_type = 'CUSTOMER'
       AND customer_id    IS NOT NULL AND debtor_shop_id IS NULL
       AND receipt_id     IS NOT NULL AND order_id       IS NULL)
  ),

  -- Overpayment is rejected at the DB level, not only in the service.
  CONSTRAINT chk_debts_paid_not_over CHECK (paid_amount <= total_amount),

  -- A shop cannot owe itself.
  CONSTRAINT chk_debts_no_self_debt CHECK (debtor_shop_id IS DISTINCT FROM creditor_shop_id)
);

-- One live debt per source. Scoped to non-CANCELLED so a cancelled debt does
-- not block re-opening one for the same order/receipt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_order_unique
  ON debts(order_id)   WHERE order_id   IS NOT NULL AND status <> 'CANCELLED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_receipt_unique
  ON debts(receipt_id) WHERE receipt_id IS NOT NULL AND status <> 'CANCELLED';

-- Listing paths: "who owes me, still open" and "everything for one debtor".
CREATE INDEX IF NOT EXISTS idx_debts_creditor_status ON debts(creditor_shop_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_debtor_shop     ON debts(debtor_shop_id) WHERE debtor_shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debts_customer        ON debts(customer_id)    WHERE customer_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debts_created_at      ON debts(created_at DESC);

-- DEBT PAYMENTS
-- Append-only ledger: rows are never updated or deleted, so the collection
-- history stays auditable. A mistaken payment is undone by inserting a
-- reversal row with a negative amount, which keeps
-- SUM(amount) = debts.paid_amount true without rewriting history.
CREATE TABLE IF NOT EXISTS debt_payments (
  id                  SERIAL PRIMARY KEY,
  debt_id             INTEGER        NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount              DECIMAL(15, 2) NOT NULL,
  method              VARCHAR(20)    NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH', 'TRANSFER', 'OTHER')),
  is_reversal         BOOLEAN        NOT NULL DEFAULT FALSE,
  -- Which collection this reversal undoes. Self-referencing so "was this
  -- payment already reversed?" is a lookup on this table alone, and so the
  -- pair stays linked in the history instead of being two unrelated rows that
  -- happen to cancel out.
  reverses_payment_id INTEGER        REFERENCES debt_payments(id) ON DELETE RESTRICT,
  note                TEXT,
  paid_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  created_by          INTEGER        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- Sign carries the meaning: collections are positive, reversals negative.
  -- A reversal must name its target; a collection must not have one.
  CONSTRAINT chk_debt_payments_sign CHECK (
    (is_reversal = FALSE AND amount > 0 AND reverses_payment_id IS NULL) OR
    (is_reversal = TRUE  AND amount < 0 AND reverses_payment_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_debt_payments_debt_id ON debt_payments(debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_paid_at ON debt_payments(paid_at DESC);

-- A collection can be reversed at most once. Without this, two concurrent
-- reverse requests for the same payment could both insert and drive
-- paid_amount below what was actually collected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_payments_reverses_unique
  ON debt_payments(reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;

-- RECEIPTS -> CUSTOMER LINK
-- Nullable: the normal case is still an anonymous cash sale with no customer
-- row at all. Set only when the sale is on credit (or when the shop wants the
-- buyer on record). ON DELETE RESTRICT because customers are soft-deleted —
-- a hard delete that silently detached historical receipts would corrupt the
-- customer's purchase history.
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS customer_id INTEGER NULL REFERENCES customers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_receipts_customer_id ON receipts(customer_id) WHERE customer_id IS NOT NULL;
