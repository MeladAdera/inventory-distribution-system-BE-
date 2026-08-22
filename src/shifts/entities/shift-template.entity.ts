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
 * An employee on a slot's rota, trimmed to what the grid renders. Deactivated
 * staff are filtered out on read rather than unassigned on deactivation, so a
 * user switched off in the users module cannot leave a name on the roster that
 * nothing here was told to remove.
 */
export class ShiftAssignee {
  id!: number;
  name!: string;
}

/**
 * A template as the grid needs it: the length the owner actually cares about,
 * and who is on it.
 *
 * `duration_minutes` is derived from the window rather than stored, so it can
 * never disagree with the times beside it — and only the day's opening hours
 * settle whether a window crosses midnight, so it cannot be a column.
 */
export class ShiftTemplateWithDuration extends ShiftTemplate {
  duration_minutes!: number;
  assignees!: ShiftAssignee[];
}
