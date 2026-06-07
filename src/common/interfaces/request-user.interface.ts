import { UserRole } from '../enums/user-role.enum';

export interface RequestUser {
  id: number;
  email: string;
  role: UserRole;
  shopId: number | null;
}
