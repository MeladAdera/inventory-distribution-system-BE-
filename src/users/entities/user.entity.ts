import { UserRole } from '../../common/enums/user-role.enum';

export class User {
  id!: number;
  shop_id!: number | null;
  name!: string;
  email!: string;
  password_hash!: string;
  role!: UserRole;
  is_active!: boolean;
  created_at!: Date;
  updated_at!: Date;
}
