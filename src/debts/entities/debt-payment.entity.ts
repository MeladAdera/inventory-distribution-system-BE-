export type PaymentMethod = 'CASH' | 'TRANSFER' | 'OTHER';

/**
 * One row per money movement against a debt. Append-only: rows are never
 * updated and never deleted, so the collection history stays readable
 * ("collected 50, then reversed 20" rather than "was always 30").
 *
 * The sign carries the meaning — collections are positive, reversals negative —
 * which keeps `SUM(amount) = debts.paid_amount` true without special cases.
 */
export class DebtPayment {
  id!: number;
  debt_id!: number;
  /** DECIMAL(15,2) as a string. Negative when `is_reversal` is true. */
  amount!: string;
  method!: PaymentMethod;
  is_reversal!: boolean;
  /** The collection this reversal undoes. Null on collections. */
  reverses_payment_id!: number | null;
  note!: string | null;
  paid_at!: Date;
  created_by!: number;
  /**
   * The shift whose drawer this cash moved through, so the close can add it up.
   * Null when it touched no drawer — a transfer, or the shop safe.
   */
  shift_session_id!: number | null;
  created_at!: Date;
}
