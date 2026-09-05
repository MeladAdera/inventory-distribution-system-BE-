export class ReceiptItem {
  id!: number;
  receipt_id!: number;
  inventory_id!: number;
  product_id!: number;
  product_name!: string;
  // Category of the sold product, for receipt-detail card UIs.
  // Null when uncategorized. category_icon is a Lucide icon name.
  category_id!: number | null;
  category_name!: string | null;
  category_icon!: string | null;
  quantity!: number;
  price!: string;
  quantity_before!: number;
  quantity_after!: number;
}

export class Receipt {
  id!: number;
  shop_id!: number;
  created_by!: number;
  notes!: string | null;
  is_free!: boolean;
  is_cancelled!: boolean;
  cancelled_at!: Date | null;
  cancelled_by!: number | null;
  cancel_reason!: string | null;
  // Set only on credit sales (or when the shop wants the buyer on record); an
  // ordinary cash sale stays anonymous.
  customer_id!: number | null;
  // The id the client generated for this sale, reused on every retry. Null on
  // receipts written before idempotency existed, and on any client that does
  // not send one. See `06-ReceiptIdempotency.sql`.
  client_receipt_id!: string | null;
  /**
   * The shift whose drawer this sale's cash went into. Null when it was rung
   * up with no shift open, or before shifts existed.
   */
  shift_session_id!: number | null;
  created_at!: Date;
}

export class ReceiptWithItems extends Receipt {
  total_price!: number;
  items!: ReceiptItem[];
  customer_name!: string | null;
  // Present when the sale was not paid in full, so the cashier sees what is
  // still owed without a second request. Null on a normal paid sale.
  debt!: DebtOnReceipt | null;
}

/** The receivable side of a credit sale, flattened for the receipt response. */
export class DebtOnReceipt {
  id!: number;
  total_amount!: string;
  paid_amount!: string;
  remaining!: string;
  status!: string;
}

export class ReceiptListItem {
  id!: number;
  shop_id!: number;
  shop_name!: string;
  created_by!: number;
  created_by_name!: string;
  total_items!: number;
  notes!: string | null;
  is_free!: boolean;
  is_cancelled!: boolean;
  created_at!: Date;
}
