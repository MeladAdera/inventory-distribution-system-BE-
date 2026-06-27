export class AuditLog {
  id!: number;
  shop_id!: number | null;
  user_id!: number | null;
  type!: string;
  action!: string;
  entity_type!: string | null;
  entity_id!: number | null;
  quantity!: number | null;
  amount!: number | null;
  notes!: string | null;
  created_at!: Date;
  user_name!: string | null;
  shop_name!: string | null;
}

export class AuditLogDetail extends AuditLog {
  product_name!: string | null;
}
