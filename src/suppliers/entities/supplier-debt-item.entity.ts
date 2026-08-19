/**
 * One product line on a supplier invoice. Written only alongside the payable
 * that owns it, never on its own — the line and the stock movement it caused
 * are created in the same transaction.
 */
export class SupplierDebtItem {
  id!: number;
  debt_id!: number;
  product_id!: number;
  inventory_id!: number;
  quantity!: number;
  /** DECIMAL(15,4) as a string — see `src/common/utils/money.util.ts`. */
  unit_cost!: string;
  /** Generated column: ROUND(quantity * unit_cost, 2). */
  line_total!: string;
  created_at!: Date;
}

/**
 * The read shape. `avg_cost` is the shop's moving average *after* this line was
 * folded in, which is the number the owner actually wants to see next to a
 * purchase price — "I paid 12, my basis is now 10.67".
 */
export class SupplierDebtItemDetail extends SupplierDebtItem {
  product_name!: string;
  avg_cost!: string;
  sale_price!: string;
}
