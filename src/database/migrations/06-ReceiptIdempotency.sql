-- ============================================================
-- Receipt idempotency
--
-- POST /receipts writes the receipt, its items, the stock adjustments and
-- (on a credit sale) the debt in one transaction. If that transaction commits
-- but the response never reaches the client — a slow connection, a request
-- timeout, an offline queue replaying — the retry rings the whole sale up a
-- second time. The result is a complete, internally consistent duplicate:
-- nothing looks corrupt, the shop is simply short of stock with no explanation.
--
-- The client sends an id it generates itself, once per sale, and reuses it on
-- every retry. That id is what makes the write idempotent.
--
-- This is a fix for behaviour already in production, independent of the shift
-- work, which is why it is its own migration and can ship on its own.
-- ============================================================

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS client_receipt_id UUID NULL;

-- Partial, because every receipt written before this column existed — and any
-- sale rung up by a client that does not send an id — leaves it NULL, and
-- NULLs must not compete for uniqueness with each other.
--
-- The index is also the race guard, not only a lookup path: two replays that
-- both miss the pre-check are serialized here, and the loser's transaction
-- rolls back whole rather than leaving a second sale behind.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_client_id
  ON receipts(client_receipt_id)
  WHERE client_receipt_id IS NOT NULL;
