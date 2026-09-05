-- ============================================================
-- Shifts, part 5: attribute money to the shift it moved in
--
-- Every movement of cash is stamped with the session it happened in, so the
-- close can add up what should be in the drawer. Nullable throughout: sales
-- rung up before this existed, and any client that sends nothing, stay valid.
-- ============================================================

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS shift_session_id INTEGER NULL
  REFERENCES shift_sessions(id) ON DELETE SET NULL;

-- Debt payments carry it too, and not only for tidiness. A customer settling
-- an old bill hands cash to whoever is on shift *now*, so the money belongs to
-- the collecting shift rather than the one that made the original sale. The
-- same column also catches the down payment on a credit sale, which is written
-- here rather than on the receipt.
ALTER TABLE debt_payments
  ADD COLUMN IF NOT EXISTS shift_session_id INTEGER NULL
  REFERENCES shift_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_shift_session
  ON receipts(shift_session_id) WHERE shift_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_debt_payments_shift_session
  ON debt_payments(shift_session_id) WHERE shift_session_id IS NOT NULL;

-- For the close: "does this receipt have a debt?" is what separates a sale
-- paid fully in cash from a credit sale whose cash arrived as a payment row.
--
-- idx_debts_receipt_unique cannot serve it — that index is partial on
-- status <> 'CANCELLED', and the question has to be asked without a status
-- filter. A cancelled debt still proves the sale was made on credit, and
-- ignoring it would make a cancelled credit sale count its full total as cash.
CREATE INDEX IF NOT EXISTS idx_debts_receipt
  ON debts(receipt_id) WHERE receipt_id IS NOT NULL;
