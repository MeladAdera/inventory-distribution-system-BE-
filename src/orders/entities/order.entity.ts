export class Order {
  id!: string;
  orderNumber!: string;
  userId!: string;
  shopId!: string;
  status!: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  totalPrice!: number;
  totalItems!: number;
  deliveryAddress!: string;
  notes?: string;
  createdAt!: Date;
  updatedAt!: Date;
}
