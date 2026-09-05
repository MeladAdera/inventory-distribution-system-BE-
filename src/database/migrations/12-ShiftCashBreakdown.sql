-- ============================================================
-- Shifts, part 7: freeze the parts, not only the total
--
-- The close already stores expected_cash and cash_difference so a later
-- cancellation cannot rewrite a settled drawer. But it stored only the answer,
-- not the working — and "why was I short?" is the whole reason an owner opens a
-- past shift.
--
-- Recomputing the three components on read would defeat the freeze: a receipt
-- cancelled next week would change them while the total beside them stayed put,
-- and the row would visibly stop adding up. So they are frozen alongside it.
--
-- Null on shifts closed before this existed, and on every open shift.
-- ============================================================

ALTER TABLE shift_sessions
  -- Sales settled entirely in cash. A credit sale's cash is in cash_collections.
  ADD COLUMN IF NOT EXISTS cash_sales       DECIMAL(15, 2) NULL,
  -- Cash taken from customers against debts, net of reversals.
  ADD COLUMN IF NOT EXISTS cash_collections DECIMAL(15, 2) NULL,
  -- Cash handed out to suppliers from this drawer, net of reversals. Stored
  -- positive and subtracted, so the row reads the way the money moved.
  ADD COLUMN IF NOT EXISTS cash_payouts     DECIMAL(15, 2) NULL;
