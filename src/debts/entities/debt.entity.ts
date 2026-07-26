export type DebtorType = 'SHOP' | 'CUSTOMER';

export type DebtStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED';

/**
 * A debt is always raised by exactly one source document, and the debtor side
 * follows from it: an order is owed by a shop, a receipt by a customer. The
 * `chk_debts_debtor_shape` constraint enforces the same pairing in the
 * database — this union is its TypeScript mirror.
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
  creditor_shop_id!: number;
  debtor_type!: DebtorType;
  debtor_shop_id!: number | null;
  customer_id!: number | null;
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
 * renders one column instead of branching on `debtor_type`.
 */
export class DebtListItem extends Debt {
  debtor_name!: string;
  creditor_shop_name!: string;
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
