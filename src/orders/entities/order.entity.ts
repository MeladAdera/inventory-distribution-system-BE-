export type OrderStatus = 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'RECEIVED' | 'COMPLETED';

export class Order {
  id!: number;
  from_shop_id!: number;
  to_shop_id!: number;
  to_shop_name!: string;
  status!: OrderStatus;
  total_items!: number;
  created_at!: Date;
  updated_at!: Date;
}

export class OrderWithItems extends Order {
  items!: OrderItemRow[];
}

export interface OrderItemRow {
  product_id: number;
  product_name: string;
  quantity: number;
  price: number;
}
