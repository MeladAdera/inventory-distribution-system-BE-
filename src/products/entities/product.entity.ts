export class Product {
  id!: number;
  shop_id!: number;
  category_id!: number | null;
  category_name!: string | null;
  // Lucide icon name of the product's category, for catalog/card UIs. Null when uncategorized.
  category_icon!: string | null;
  name!: string;
  description!: string | null;
  barcode!: string | null;
  price!: number;
  // Buying price. Null in API responses when hidden from non-owners.
  cost_price!: number | null;
  source!: 'WAREHOUSE' | 'LOCAL';
  is_global!: boolean;
  image_url!: string | null;
  is_active!: boolean;
  created_at!: Date;
  updated_at!: Date;
  current_quantity!: number;
  // Only populated on the shop-facing catalog list (findPaginatedForShop): true
  // when this shop already tracks the product in its inventory. Lets the
  // "Browse Products" cards render Added ✓ vs Add.
  in_inventory?: boolean;
}
