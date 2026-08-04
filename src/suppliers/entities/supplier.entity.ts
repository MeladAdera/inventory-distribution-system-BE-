/**
 * A shop's supplier for goods bought on credit (accounts payable). Mirrors
 * `Customer` deliberately: shop-scoped, not a CRM, phone is the identity key.
 */
export class Supplier {
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
 * The list view carries each supplier's outstanding balance, because "who do
 * I still owe, and how much" is the only reason this screen gets opened.
 */
export class SupplierListItem extends Supplier {
  open_debts_count!: number;
  /** DECIMAL(15,2) as a string — see `src/common/utils/money.util.ts`. */
  total_remaining!: string;
}
