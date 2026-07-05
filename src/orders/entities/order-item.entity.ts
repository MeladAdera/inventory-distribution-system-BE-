export class OrderItem {
  id!: number;
  order_id!: number;
  product_id!: number;
  quantity!: number;
  price!: number;
  // Cost snapshot at order time — stored for profit analytics, not exposed in order responses
  cost_price!: number;
}
