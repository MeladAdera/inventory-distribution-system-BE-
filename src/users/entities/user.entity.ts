export class User {
  id!: string;
  email!: string;
  name!: string;
  phone?: string;
  password!: string;
  role!: 'admin' | 'shop_manager' | 'user';
  shopId?: string;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
