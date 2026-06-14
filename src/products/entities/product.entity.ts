export class Product {
  id!: number;
  shop_id!: number;
  category_id!: number | null;
  category_name!: string | null;
  name!: string;
  description!: string | null;
  barcode!: string | null;
  price!: number;
  source!: 'WAREHOUSE' | 'LOCAL';
  is_global!: boolean;
  is_active!: boolean;
  created_at!: Date;
  updated_at!: Date;
  current_quantity!: number;
}
