/**
 * A shop's credit customer. Deliberately not a CRM: only people who take goods
 * on deferred payment are stored, so a shop is never forced to register the
 * walk-in cash buyers who make up most of its sales.
 */
export class Customer {
  id!: number;
  shop_id!: number;
  name!: string;
  phone!: string | null;
  note!: string | null;
  is_active!: boolean;
  created_at!: Date;
  updated_at!: Date;
}

/**
 * The list view carries each customer's outstanding balance, because "who owes
 * me, and how much" is the only reason this screen gets opened.
 */
export class CustomerListItem extends Customer {
  open_debts_count!: number;
  /** DECIMAL(15,2) as a string — see `src/common/utils/money.util.ts`. */
  total_remaining!: string;
}
