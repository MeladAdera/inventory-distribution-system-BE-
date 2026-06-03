export class Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  sku: string;
  categoryId: string;
  image?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
