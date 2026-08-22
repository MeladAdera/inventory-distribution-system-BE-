-- ============================================================
-- Shifts, part 3: who works which slot
--
-- The link between the plan and the people. Several employees may sit on one
-- template: a weekly slot is worked by whoever is on rota that week, so both
-- halves of a rotation belong on it, and someone covering a sick colleague
-- should not read as unscheduled.
--
-- How many people work at the same *moment* is a different question, settled
-- by the one-open-session-per-shop rule in the next part, not here.
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_assignments (
  id                SERIAL      PRIMARY KEY,
  shift_template_id INTEGER     NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  user_id           INTEGER     NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Assigning the same person twice says nothing the first row did not.
  -- Doubles as the index for "who is on this slot", the read path of the grid.
  UNIQUE (shift_template_id, user_id)
);

-- The other direction: "which slots does this employee work", for the
-- off-schedule check when a session opens.
CREATE INDEX IF NOT EXISTS idx_shift_assignments_user
  ON shift_assignments(user_id);
