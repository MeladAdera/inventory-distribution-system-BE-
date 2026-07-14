export class Category {
  id!: number;
  shop_id!: number;
  name!: string;
  // Lucide icon name for the catalog UI (e.g. 'Cigarette', 'CupSoda'). Null when unset.
  icon!: string | null;
  image_url!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
