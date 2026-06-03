export class Inventory {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderLevel: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
  createdAt: Date;
  updatedAt: Date;
}
