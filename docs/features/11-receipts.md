# Receipts — Feature Documentation

## Overview

Receipts record batch consumption events — one or more inventory items decreased together in a single atomic operation. They give shop staff a formal, auditable way to log end-of-day stock counts, damage write-offs, or any group of simultaneous decreases without having to call `PATCH /inventory/:id` separately per product.

A Receipt groups what would otherwise be isolated `ADJUSTMENT` audit log entries under a single shared identifier. The `receipt_items` table stores a quantity snapshot (`quantity_before`, `quantity_after`) at creation time, so the historical record is self-contained and does not depend on later inventory state.

---

## Business Rules

- A receipt is **immutable** after creation — there are no edit or delete endpoints.
- All inventory adjustments in a receipt are applied inside a **single database transaction** — either every item succeeds or the entire request is rolled back and no quantities are changed.
- `quantity` in each item is always a **positive integer** (units consumed). The backend applies it as a negative adjustment internally.
- If any item would bring `current_quantity` below `0` the whole request is rejected with `400` before any quantity is changed.
- Sending the same `inventoryId` twice in one request is rejected with `400` before the transaction opens.
- `shop_id` is taken from the authenticated user's JWT — the client never sends it.
- Non-admin users can only create receipts for their own shop's inventory. Sending an `inventoryId` that belongs to a different shop returns `403`.
- Each receipt creation writes one `INVENTORY / ADJUSTMENT` audit log entry per item with `notes` set to `"Receipt #<id>"`, keeping the audit trail consistent with single-item adjustments.
- Low-stock notifications are fired after the transaction commits (fire-and-forget) for any item whose `quantity_after <= low_stock_threshold`.

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `POST /receipts` | Own shop (warehouse) | Own shop | Own shop |
| `GET /receipts` | All shops (optional `shopId` filter) | Own shop only | Own shop only |
| `GET /receipts/:id` | Any receipt | Own shop only (403 otherwise) | Own shop only (403 otherwise) |

---

## Endpoints

### POST /receipts

Creates a receipt and atomically applies all inventory decreases.

**Request body:**
```json
{
  "items": [
    { "inventoryId": 7, "quantity": 5 },
    { "inventoryId": 8, "quantity": 3 }
  ],
  "notes": "End of day stock count"
}
```

**Processing (all inside one transaction):**
1. Validate no duplicate `inventoryId` values in the request — `400` if found (before the transaction opens).
2. Lock all target inventory rows with `SELECT ... FOR UPDATE` to prevent concurrent modifications during this transaction.
3. Verify every `inventoryId` exists — `404` if any row is missing.
4. Verify every row belongs to the authenticated user's shop — `403` if any does not.
5. For each item compute `quantity_after = current_quantity - quantity`. If any is negative, throw `400` and roll back.
6. `INSERT` the receipt header into `receipts` → obtain `receipt.id`.
7. For each item: `UPDATE inventory SET current_quantity = current_quantity - quantity WHERE id = ?`.
8. Batch-`INSERT` all rows into `receipt_items` with the snapshotted `quantity_before` and `quantity_after`.
9. For each item: write one `INVENTORY / ADJUSTMENT` audit log row with `notes = "Receipt #<id>"`.
10. Commit. After commit, fire low-stock notifications fire-and-forget for any item now at or below its threshold.

**Response `201`:**
```json
{
  "id": 1,
  "shop_id": 2,
  "created_by": 5,
  "notes": "End of day stock count",
  "created_at": "2026-06-27T10:00:00.000Z",
  "total_price": 37.00,
  "items": [
    {
      "id": 1,
      "inventory_id": 7,
      "product_id": 10,
      "product_name": "Tuna Leo",
      "quantity": 5,
      "price": "6.00",
      "quantity_before": 12,
      "quantity_after": 7
    },
    {
      "id": 2,
      "inventory_id": 8,
      "product_id": 11,
      "product_name": "Sardine Leo",
      "quantity": 3,
      "price": "2.33",
      "quantity_before": 4,
      "quantity_after": 1
    }
  ]
}
```

---

### GET /receipts

Returns a paginated list of receipts. Non-admin users are automatically scoped to their own shop. Admin may optionally filter by `shopId`.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `shopId` | number | Admin only — filter by shop |
| `createdBy` | number | Filter by the user who created the receipt |
| `fromDate` | ISO date | Start of date range (inclusive, `>=`) |
| `toDate` | ISO date | End of date range (inclusive, `< toDate + 1 day`) |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10, max: 100) |

**Response shape:**
```json
{
  "data": [
    {
      "id": 1,
      "shop_id": 2,
      "shop_name": "Cairo Branch",
      "created_by": 5,
      "created_by_name": "Sara Ali",
      "total_items": 2,
      "notes": "End of day stock count",
      "created_at": "2026-06-27T10:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 1,
  "totalPages": 1,
  "hasNext": false,
  "hasPrev": false
}
```

> `shop_name` and `created_by_name` are always resolved from their IDs — no separate lookup needed.  
> Results are ordered by `created_at DESC` (newest first).

---

### GET /receipts/:id

Returns a single receipt with its full `items` array — same shape as the `POST /receipts` response, including `price` per item and `total_price`.

- `404` if the receipt does not exist.
- `403` if a non-admin requests a receipt belonging to a different shop.

---

## DTOs

### CreateReceiptDto — `src/receipts/dto/create-receipt.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `items` | `ReceiptItemDto[]` | Yes | Non-empty array; each item validated with `@ValidateNested` |
| `notes` | string | No | Max 500 characters |

### ReceiptItemDto (nested inside CreateReceiptDto)

| Field | Type | Required | Rules |
|---|---|---|---|
| `inventoryId` | number | Yes | Positive integer — the `inventory.id` of the row to decrease |
| `quantity` | number | Yes | Positive integer — units consumed |

> `price` is not sent by the client. It is captured automatically from `products.price` at creation time — a snapshot, so it does not change if the product price is updated later. Same behaviour as `order_items.price`.

### ReceiptQueryDto — `src/receipts/dto/receipt-query.dto.ts`

Extends `PaginationDto` (`page`, `limit`, `offset`) and adds:

| Field | Type | Description |
|---|---|---|
| `shopId` | number | Admin only filter |
| `createdBy` | number | Filter by creator user ID |
| `fromDate` | string | ISO date string |
| `toDate` | string | ISO date string |

---

## Audit Log Integration

Every receipt creation produces one `audit_logs` row per item:

| Field | Value |
|---|---|
| `type` | `INVENTORY` |
| `action` | `ADJUSTMENT` |
| `entity_type` | `inventory` |
| `entity_id` | the `inventory.id` of the adjusted row |
| `quantity` | negative value (e.g. `-5` for 5 units consumed) |
| `notes` | `"Receipt #<receipt_id>"` |
| `shop_id` | authenticated user's shop id |
| `user_id` | authenticated user's id |

All audit log writes happen inside the same transaction as the inventory adjustments — if any write fails, all roll back.

---

## Schema

Defined in `src/database/migrations/00-InitialSchema.sql`:

```sql
CREATE TABLE receipts (
  id         SERIAL PRIMARY KEY,
  shop_id    INTEGER NOT NULL REFERENCES shops(id)  ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_shop_created ON receipts(shop_id, created_at DESC);
CREATE INDEX idx_receipts_created_by  ON receipts(created_by);

CREATE TABLE receipt_items (
  id              SERIAL PRIMARY KEY,
  receipt_id      INTEGER NOT NULL REFERENCES receipts(id)   ON DELETE CASCADE,
  inventory_id    INTEGER NOT NULL REFERENCES inventory(id)  ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  quantity_before INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL CHECK (quantity_after >= 0),
  price           DECIMAL(15, 2) NOT NULL,
  cost_price      DECIMAL(15, 2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_receipt_items_receipt_id   ON receipt_items(receipt_id);
CREATE INDEX idx_receipt_items_inventory_id ON receipt_items(inventory_id);
```

> `price`/`cost_price` are transaction-time snapshots — see [Cost Price & Profit Analytics](./13-cost-price-profit.md).

The composite index `(shop_id, created_at DESC)` on `receipts` matches the primary list query pattern — filter by shop, order by date — in a single index scan.

---

## Key Design Decisions

### Why `SELECT ... FOR UPDATE` instead of validating before the transaction?

The existing `PATCH /inventory/:id` validates `current_quantity + adjustment >= 0` in the service before opening a transaction. For a single row that window is negligibly small. For receipts, validating N rows outside the transaction and then updating them inside creates a window where a concurrent receipt (or a regular adjustment) could decrement one of those rows between the check and the update, silently breaking the `>= 0` guarantee. `FOR UPDATE` locks all target rows immediately, collapsing the check-then-act into an atomic read-validate-write.

### Why reject duplicate `inventoryId` values before the transaction?

`SELECT ... FOR UPDATE ... WHERE id = ANY($1)` deduplicates the result — two entries for the same ID return one row. The length check `inventoryRows.length !== dto.items.length` would then incorrectly throw `404`. Catching duplicates upfront gives a precise `400` error instead of a confusing "not found".

### Why snapshot `quantity_before` / `quantity_after` at creation time?

The `inventory` table is a live counter that changes with every adjustment. If `receipt_items` only stored the consumed `quantity`, the before/after state would have to be reconstructed from the audit log, which is fragile and expensive. Storing the snapshot at creation time makes each receipt self-contained — the historical view is always correct regardless of subsequent inventory changes.

### Why batch-insert `receipt_items` with dynamic placeholders instead of per-row inserts?

One `INSERT ... VALUES ($1,$2,...), ($3,$4,...), ...` statement is one round trip. Per-row inserts inside a loop are N round trips inside the transaction, each holding the row locks longer. For typical receipt sizes (2–20 items) the difference is negligible, but the batch approach is strictly better and not more complex.

### Why fire low-stock notifications outside the transaction?

`notifyLowStock` writes to the `notifications` table. Running it inside the receipt transaction means a notification write failure would roll back all inventory adjustments — the inventory becomes the collateral damage of a non-critical side-effect. Firing after commit with `.catch(err => logger.error(...))` keeps the critical path clean.

---

## File Map

```
src/receipts/
├── receipts.module.ts                     imports DatabaseModule, AuditLogsModule,
│                                          NotificationsModule, InventoryModule
├── controllers/
│   └── receipts.controller.ts            POST /receipts, GET /receipts, GET /receipts/:id
├── services/
│   └── receipts.service.ts               create, findAll, findById
├── repositories/
│   └── receipts.repository.ts            insertReceipt, insertItems,
│                                          findById, findPaginated
├── entities/
│   └── receipt.entity.ts                 Receipt, ReceiptItem, ReceiptWithItems,
│                                          ReceiptListItem
└── dto/
    ├── create-receipt.dto.ts             items: ReceiptItemDto[], notes?
    └── receipt-query.dto.ts              extends PaginationDto + shopId?,
                                          createdBy?, fromDate?, toDate?

src/inventory/repositories/
└── inventory.repository.ts               + findByIdsForUpdate(ids, client)

src/database/migrations/
└── 00-InitialSchema.sql                  receipts, receipt_items tables
```

---

## Error Keys

| Key | HTTP | Args | Thrown when |
|---|---|---|---|
| `receipt.NOT_FOUND` | 404 | — | Receipt ID does not exist |
| `receipt.ACCESS_DENIED` | 403 | — | Non-admin requests a receipt from a different shop |
| `receipt.INVENTORY_NOT_FOUND` | 404 | — | One or more `inventoryId` values do not exist in the DB |
| `receipt.NEGATIVE_STOCK` | 400 | `{product}`, `{current}`, `{required}` | An item's `quantity` would bring stock below zero |
| `receipt.DUPLICATE_INVENTORY_IDS` | 400 | — | The same `inventoryId` appears more than once in `items` |

> Keys with args are thrown using the object form: `throw new BadRequestException({ key, args })`.  
> See `docs/features/10-i18n-localization.md` for full i18n details.
