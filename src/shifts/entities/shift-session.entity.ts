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

/**
 * A row of the owner's shift history.
 *
 * `sales_total` is what was *sold*, which is not what landed in the drawer — a
 * credit sale counts here in full while only its down payment reaches the cash
 * figures. The two answer different questions: how the shift traded, and
 * whether its cash added up.
 */
export class ShiftSessionListItem extends ShiftSessionWithNames {
  receipt_count!: number;
  sales_total!: string;
}

/** One receipt as the shift-detail screen lists it. */
export class ShiftReceiptLine {
  id!: number;
  created_at!: Date;
  created_by!: number;
  created_by_name!: string;
  customer_name!: string | null;
  is_free!: boolean;
  is_cancelled!: boolean;
  /** True when the sale opened a debt, i.e. its cash was only part of the total. */
  on_credit!: boolean;
  total_price!: string;
}

/**
 * One shift, with the receipts that explain it.
 *
 * The cash figures come from the stored columns and are never recomputed. If a
 * receipt was cancelled after the close it appears in the list marked cancelled
 * while the frozen totals still show what was counted on the night — which is
 * the true story of both moments.
 */
export class ShiftSessionDetail extends ShiftSessionListItem {
  receipts!: ShiftReceiptLine[];
}

export class ShiftReportByEmployee {
  user_id!: number;
  user_name!: string;
  shifts!: number;
  receipt_count!: number;
  sales_total!: string;
  /** Sum of differences over closed shifts. Negative means short overall. */
  cash_difference!: string;
  short_shifts!: number;
}

export class ShiftReportByShift {
  shift_template_id!: number | null;
  shift_template_name!: string | null;
  weekday!: number | null;
  shifts!: number;
  receipt_count!: number;
  sales_total!: string;
  cash_difference!: string;
}

export class ShiftReport {
  from!: string | null;
  to!: string | null;
  by_employee!: ShiftReportByEmployee[];
  by_shift!: ShiftReportByShift[];
}
