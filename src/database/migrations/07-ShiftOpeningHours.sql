-- ============================================================
-- Shifts, part 1: shop opening hours + shop timezone
--
-- The opening hours are the boundary every shift must fit inside, which is
-- what makes "how long is this shift" a derived number rather than a guess.
-- ============================================================

-- Shift times are stored as bare wall-clock TIME values ('14:00'), which is
-- correct for something that recurs every week — but "8am" has to mean 8am in
-- the shop's own city. Nothing in this schema pinned a zone before now, so a
-- server running UTC would silently move every shift boundary, and an
-- overnight session would land on the wrong business_date.
--
-- NOT NULL with a default so existing shops are valid immediately; owners can
-- change it per shop from the opening-hours screen.
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Damascus';

-- One row per weekday, weekday 0 = Sunday to match JavaScript's getDay(), so
-- the client never converts between two numbering schemes.
--
-- close_time earlier than open_time means the shop trades past midnight
-- (18:00 -> 02:00). Postgres TIME also accepts the literal '24:00:00', which
-- is how "open until the end of the day" is written without wrapping to 0.
--
-- No open_time < close_time constraint for exactly that reason: the crossing
-- case is legitimate, so the shape is checked in the service where the
-- midnight rule lives, not here where it would forbid it.
CREATE TABLE IF NOT EXISTS shop_opening_hours (
  shop_id    INTEGER  NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  weekday    SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_time  TIME     NOT NULL,
  close_time TIME     NOT NULL,
  -- A closed day keeps its times so the owner's last setting survives
  -- toggling the day off and back on; readers must ignore them when true.
  is_closed  BOOLEAN  NOT NULL DEFAULT FALSE,

  PRIMARY KEY (shop_id, weekday)
);
