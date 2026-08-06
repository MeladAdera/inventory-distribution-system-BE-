export class AuditLog {
  id!: number;
  shop_id!: number | null;
  user_id!: number | null;
  type!: string;
  action!: string;
  entity_type!: string | null;
  entity_id!: number | null;
  receipt_id!: number | null;
  quantity!: number | null;
  amount!: number | null;
  notes!: string | null;
  created_at!: Date;
  user_name!: string | null;
  shop_name!: string | null;
  // Display text for the codes above, in the caller's language. The raw codes
  // stay on the response because the list endpoint filters on them.
  type_label!: string | null;
  action_label!: string | null;
  entity_type_label!: string | null;
}

export class AuditLogDetail extends AuditLog {
  product_name!: string | null;
}
