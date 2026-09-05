-- ============================================================
-- Shifts, part 4: sessions — what actually happened
--
-- A template says what should happen; a session records what did. One row per
-- clock-in, holding both the person and the till, because one employee works
-- one shift and therefore one drawer.
--
-- The cash columns are created here but stay null until the close is built.
-- One table, one migration: the runner records each file by name and never
-- re-runs it, so a column added later would need its own file.
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_sessions (
  id                SERIAL       PRIMARY KEY,
  shop_id           INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id           INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- The slot that was actually running when this opened, which is not always
  -- the one the person is rostered on: covering a colleague still attributes
  -- the money to the shift being worked. NULL when nothing was running at all.
  -- ON DELETE SET NULL rather than RESTRICT — templates are soft-deleted, so
  -- this only fires if a shop is torn down.
  shift_template_id INTEGER      NULL REFERENCES shift_templates(id) ON DELETE SET NULL,

  -- The trading day this belongs to, as the calendar reads it in the shop's own
  -- city. Stamped from opened_at at insert and never recomputed: a session
  -- opened 23:30 and closed 02:00 belongs to the day it opened, and rederiving
  -- it later from a closing time would move it.
  business_date     DATE         NOT NULL,

  opened_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ  NULL,
  -- Who counted the money. Not always user_id: an owner may force-close an
  -- abandoned shift, and the next employee may count a drawer left open. The
  -- audit trail must not read as though the absent employee did it.
  closed_by         INTEGER      NULL REFERENCES users(id) ON DELETE SET NULL,

  opening_float     DECIMAL(15, 2) NOT NULL CHECK (opening_float >= 0),
  -- What a person counted by hand at the close.
  counted_cash      DECIMAL(15, 2) NULL,
  -- What the server worked out should be there. Frozen at close, never
  -- recomputed on read: cancelling a receipt next week must not make last
  -- Tuesday's drawer look short.
  expected_cash     DECIMAL(15, 2) NULL,
  cash_difference   DECIMAL(15, 2) NULL,

  -- Opened outside the person's own rostered slot. A flag for the owner to
  -- see, never a block: the employee is not stopped from working.
  is_off_schedule   BOOLEAN      NOT NULL DEFAULT FALSE,
  notes             TEXT,

  -- For a shift opened while offline: the client generates this once and
  -- reuses it on replay, so the open is idempotent. Column and index exist
  -- now; nothing sends it until the offline work, the same way debts.due_date
  -- was added ahead of the reminders that use it.
  client_session_id UUID         NULL,

  status            VARCHAR(10)  NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'CLOSED'))
);

-- One shop, one open shift. This is "one employee works one shift" expressed
-- where it cannot be bypassed, and it makes "the shop's open session" a single
-- unambiguous row — which is what lets a sale be attributed without being told
-- which shift it belongs to.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_sessions_one_open_shop
  ON shift_sessions(shop_id) WHERE status = 'OPEN';

-- And nobody is clocked in twice. Implied by the rule above while a user
-- belongs to one shop, kept explicit so relaxing that never silently allows it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_sessions_one_open_user
  ON shift_sessions(user_id) WHERE status = 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_sessions_client_id
  ON shift_sessions(client_session_id) WHERE client_session_id IS NOT NULL;

-- The owner's history: "this shop's shifts, newest first", and per employee.
CREATE INDEX IF NOT EXISTS idx_shift_sessions_shop_date
  ON shift_sessions(shop_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_shift_sessions_user
  ON shift_sessions(user_id, business_date DESC);
