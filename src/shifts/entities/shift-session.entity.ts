export type ShiftSessionStatus = 'OPEN' | 'CLOSED';

/**
 * One clock-in: who worked, when, and what was in the drawer.
 *
 * The fact, as against the plan a `ShiftTemplate` holds. `shift_template_id`
 * records the slot that was actually running, which is not always the one the
 * person is rostered on — someone covering a colleague still works that shift,
 * and the money still belongs to it.
 *
 * Money fields are DECIMAL(15,2) and stay **strings** end to end; see
 * `src/common/utils/money.util.ts`.
 */
export class ShiftSession {
  id!: number;
  shop_id!: number;
  user_id!: number;
  shift_template_id!: number | null;
  /** `YYYY-MM-DD` in the shop's timezone, taken from `opened_at`. */
  business_date!: string;
  opened_at!: Date;
  closed_at!: Date | null;
  /** Who counted the money — not always `user_id`. Null while open. */
  closed_by!: number | null;
  opening_float!: string;
  counted_cash!: string | null;
  expected_cash!: string | null;
  cash_difference!: string | null;
  /** Opened outside this person's own rostered slot. Visibility, not a block. */
  is_off_schedule!: boolean;
  notes!: string | null;
  client_session_id!: string | null;
  status!: ShiftSessionStatus;
}

/**
 * A session with the names a screen needs, so the client renders "Ahmad —
 * Morning" without two more lookups.
 *
 * `shift_template_name` is null when the session was opened with no slot
 * running, which is exactly when `is_off_schedule` is true.
 */
export class ShiftSessionWithNames extends ShiftSession {
  user_name!: string;
  shift_template_name!: string | null;
}
