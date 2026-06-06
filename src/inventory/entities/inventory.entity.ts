export class Inventory {
  id!: number;
  shop_id!: number;
  product_id!: number;
  current_quantity!: number;
  low_stock_threshold!: number;
  updated_at!: Date;
}

export class InventoryWithProduct extends Inventory {
  product_name!: string;
  is_low_stock!: boolean;
}
