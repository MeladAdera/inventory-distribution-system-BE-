export class Inventory {
  id!: number;
  shop_id!: number;
  product_id!: number;
  current_quantity!: number;
  low_stock_threshold!: number;
  // Moving-average unit cost of the stock currently held in this row.
  // DECIMAL(10,4) in the DB; pg returns numeric columns as strings, so this is
  // a string (e.g. "32.5000") — parseFloat before doing arithmetic.
  avg_cost!: string;
  // Per-shop selling price. Seeded from products.price on first stock-in, then
  // owned by the shop (set via PATCH /inventory/:id/price). A sale snapshots
  // this into receipt_items.price. DECIMAL(10,2) → string, like avg_cost.
  sale_price!: string;
  updated_at!: Date;
}

export class InventoryWithProduct extends Inventory {
  product_name!: string;
  is_low_stock!: boolean;
}
