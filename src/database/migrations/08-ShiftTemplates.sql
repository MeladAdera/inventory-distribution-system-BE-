-- ============================================================
-- Shifts, part 2: shift templates — the plan
--
-- The owner divides a weekday's opening hours into named parts. Max four, per
-- the client's requirement. This is a weekly recurring plan, so it stores
-- times and no dates: "Monday morning" is the same row every week.
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_templates (
  id         SERIAL       PRIMARY KEY,
  shop_id    INTEGER      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  weekday    SMALLINT     NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  -- Position within the day, 1..4. Assigned by the server rather than sent by
  -- the client: two owners editing at once would otherwise both claim the same
  -- index and one would be rejected for a request that had nothing wrong.
  slot_index SMALLINT     NOT NULL CHECK (slot_index BETWEEN 1 AND 4),
  name       VARCHAR(80)  NOT NULL,
  start_time TIME         NOT NULL,
  end_time   TIME         NOT NULL,
  -- Soft delete. Sessions will reference the template they were worked under,
  -- so removing a slot must not erase which shift a past session belonged to.
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Partial on is_active, so retiring a slot frees its index for reuse. A plain
-- table-level UNIQUE would let a deleted slot keep blocking position 3 forever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_templates_slot_unique
  ON shift_templates(shop_id, weekday, slot_index)
  WHERE is_active;

-- The read path: the owner's week grid, and every rule check on a single day.
CREATE INDEX IF NOT EXISTS idx_shift_templates_shop_weekday
  ON shift_templates(shop_id, weekday)
  WHERE is_active;

-- No CHECK that start_time < end_time. end_time earlier than start_time is
-- how a shift crossing midnight is written (22:00 -> 02:00), which a shop
-- trading past midnight needs. Containment and overlap are decided in
-- `shift-time.util.ts`, where the midnight rule lives once for every caller.
