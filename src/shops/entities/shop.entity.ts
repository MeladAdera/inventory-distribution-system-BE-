import { ShopType } from '../../common/enums/shop-type.enum';

export class Shop {
  id!: number;
  name!: string;
  address!: string;
  phone!: string | null;
  type!: ShopType;
  is_active!: boolean;
  created_at!: Date;
  updated_at!: Date;
}
