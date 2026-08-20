/**
 * One part of a weekday's opening hours — the plan, not what happened.
 *
 * Weekly and recurring, so it carries times and no date: this row is "Monday
 * morning" every week. What actually happened on a given Monday is a session
 * (a later step), which points back here.
 *
 * `end_time` earlier than `start_time` means the shift runs past midnight.
 * Read every window through `shift-time.util.ts`, never by comparing the
 * strings.
 */
export class ShiftTemplate {
  id!: number;
  shop_id!: number;
  /** 0 = Sunday, matching JavaScript's `Date.getDay()`. */
  weekday!: number;
  /** Position within the day, 1..4. Assigned by the server. */
  slot_index!: number;
  name!: string;
  start_time!: string;
  end_time!: string;
  is_active!: boolean;
  created_at!: Date;
  updated_at!: Date;
}

/**
 * A template with the length the owner actually cares about. Derived from the
 * window rather than stored, so it can never disagree with the times beside it.
 */
export class ShiftTemplateWithDuration extends ShiftTemplate {
  duration_minutes!: number;
}
