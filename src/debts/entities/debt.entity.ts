export type DebtorType = 'SHOP' | 'CUSTOMER';

/**
 * Which side of the ledger a debt sits on. 'SHOP' means the money is owed to
 * one of our own shops (the existing receivables flows); 'SUPPLIER' means it
 * is owed to an outside supplier (accounts payable) — see
 * `chk_debts_party_shape` in `04-SupplierDebts.sql`, which enforces this same
 * split at the database level.
 */
export type CreditorType = 'SHOP' | 'SUPPLIER';

export type DebtStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED';

/**
 * A receivable is always raised by exactly one source document, and the
 * debtor side follows from it: an order is owed by a shop, a receipt by a
 * customer. A payable (accounts payable, `creditor_type = 'SUPPLIER'`) has no
 * source document at all — it is entered directly — so it is deliberately
 * absent from this union; see `cancelDebtById` for its cancel path instead of
 * `cancelDebt`/`DebtSource`.
 */
export type DebtSource =
  | { type: 'ORDER'; id: number }
  | { type: 'RECEIPT'; id: number };

/**
 * Money fields are DECIMAL(15,2) and stay **strings** all the way to the API —
 * see `src/common/utils/money.util.ts` for why.
 */
export class Debt {
  id!: number;
  /** NULL when `creditor_type = 'SUPPLIER'` — an outside supplier is not a shop. */
  creditor_shop_id!: number | null;
  creditor_type!: CreditorType;
  debtor_type!: DebtorType;
  debtor_shop_id!: number | null;
  customer_id!: number | null;
  /** Set only on a payable (`creditor_type = 'SUPPLIER'`). */
  supplier_id!: number | null;
  /** Set only on a payable. Free-text invoice/bill reference from the supplier. */
  invoice_no!: string | null;
  order_id!: number | null;
  receipt_id!: number | null;
  total_amount!: string;
  paid_amount!: string;
  status!: DebtStatus;
  due_date!: Date | null;
  note!: string | null;
  created_by!: number;
  created_at!: Date;
  updated_at!: Date;
}

/**
 * `remaining` is derived (`total_amount - paid_amount`), never stored — one
 * fewer column that can drift out of sync with the ledger.
 */
export class DebtBalance {
  debt_id!: number;
  total_amount!: string;
  paid_amount!: string;
  remaining!: string;
  status!: DebtStatus;
}

/**
 * List/detail row. `debtor_name` resolves from whichever side is set, so the UI
 * renders one column instead of branching on `debtor_type`. `creditor_shop_name`
 * does the same on the creditor side — despite the name, it holds a supplier's
 * name on a payable row, not a shop's.
 */
export class DebtListItem extends Debt {
  debtor_name!: string;
  creditor_shop_name!: string;
  remaining!: string;
}

/**
 * One slice of a customer payment. A FIFO collection can settle several debts
 * at once, so the response lists what landed where instead of a single total —
 * the cashier needs to tell the customer which sales are now clear.
 */
export class DebtPaymentAllocation {
  debt_id!: number;
  receipt_id!: number | null;
  /** How much of the payment went to this debt. */
  amount!: string;
  status!: DebtStatus;
  remaining!: string;
}

export class DebtsSummary {
  total_billed!: string;
  total_collected!: string;
  total_remaining!: string;
  open_count!: number;
  /**
   * Money collected against debts that were later cancelled — it has to go
   * back to the payer. v1 only reports it; processing the refund is not built.
   */
  refund_due!: string;
}

/**
 * How long money has been owed. Buckets are measured from `created_at`, not
 * `due_date` — due dates are a v2 feature and nothing sets them yet.
 *
 * These are the standard accounting bands. They are the one place the boundaries
 * are defined: the aging report and the `?agingBucket=` drill-down on
 * `GET /debts` both derive from them, so a bucket can never mean one thing in
 * the summary and something else in the list behind it.
 */
export type AgingBucket = '0-30' | '31-60' | '60+';

export const AGING_BUCKETS: AgingBucket[] = ['0-30', '31-60', '60+'];

export class DebtsAgingRow {
  bucket!: AgingBucket;
  /** Debts still owed in this band. */
  count!: number;
  /** Sum of what is still owed, not the original sale value. */
  amount!: string;
}

/**
 * A shop sits on both sides of the ledger: it owes the warehouse for orders,
 * and its own customers owe it for credit sales. Reporting them separately
 * avoids a single net figure that hides both.
 */
export class ShopDebtsSummary {
  shop_id!: number;
  /** What this shop owes (order debts to the warehouse). */
  owed_by_shop!: DebtsSummary;
  /** What this shop is owed (customer debts). Zeroes until customers exist. */
  owed_to_shop!: DebtsSummary;
}
