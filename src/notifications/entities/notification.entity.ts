export class Notification {
  id!: number;
  shop_id!: number;
  user_id!: number | null;
  title!: string;
  message!: string | null;
  type!: string | null;
  args!: Record<string, unknown> | null;
  is_read!: boolean;
  created_at!: Date;
}
