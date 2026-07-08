export class ReceiptItem {
  id!: number;
  receipt_id!: number;
  inventory_id!: number;
  product_id!: number;
  product_name!: string;
  quantity!: number;
  price!: string;
  quantity_before!: number;
  quantity_after!: number;
}

export class Receipt {
  id!: number;
  shop_id!: number;
  created_by!: number;
  notes!: string | null;
  is_free!: boolean;
  created_at!: Date;
}

export class ReceiptWithItems extends Receipt {
  total_price!: number;
  items!: ReceiptItem[];
}

export class ReceiptListItem {
  id!: number;
  shop_id!: number;
  shop_name!: string;
  created_by!: number;
  created_by_name!: string;
  total_items!: number;
  notes!: string | null;
  is_free!: boolean;
  created_at!: Date;
}
