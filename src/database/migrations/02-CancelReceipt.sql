-- CANCEL RECEIPT
-- Lets a receipt be voided: stock is restored and it is excluded from revenue.
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS is_cancelled  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by  INTEGER     NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT        NULL;
