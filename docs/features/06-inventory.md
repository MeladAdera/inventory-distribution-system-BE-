# Inventory — Feature Documentation

## Overview

Inventory management for warehouse and shop locations. Each shop and the warehouse maintain their own inventory records per product. Inventory quantities change through stock-in operations and manual adjustments. Every change is recorded in `audit_logs` as the permanent history.

`inventory.current_quantity` is always the live snapshot. `audit_logs` is the historical record.

---

## Business Rules

- Every inventory record is uniquely scoped to one `(shop_id, product_id)` pair.
- `low_stock_threshold` defaults to `10`. An item is considered low-stock when `current_quantity <= low_stock_threshold`.
- **Stock In** uses an upsert — if no inventory record exists for the product/shop pair, one is created automatically. If it already exists, the quantity is added to the current value.
- **Adjustment** can be positive (add stock) or negative (remove stock). It cannot bring `current_quantity` below `0` — a `400` is returned before the transaction opens.
- Every stock-in and adjustment runs inside a database transaction. If the audit log write fails, the quantity update rolls back.
- `EMPLOYEE` is read-only — cannot receive stock or adjust quantities.

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `GET /inventory` | All shops | Own shop only | Own shop only |
| `GET /inventory/low-stock` | All shops | Own shop only | Own shop only |
| `GET /inventory/:id` | Any record | Own shop only (403 otherwise) | Own shop only (403 otherwise) |
| `POST /inventory/stock-in` | Own shop (warehouse) | Own shop | 403 |
| `PATCH /inventory/:id` | Any record | Own shop only | 403 |

---

## Endpoints

### GET /inventory

Returns a paginated list of inventory records for the current user's shop (or all shops for admin).

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10) |
| `lowStock` | boolean | `true` → return only items where `current_quantity <= low_stock_threshold` |
| `productId` | number | Filter by a specific product |

**Response shape:**
```json
{
  "data": [
    {
      "id": 1,
      "shop_id": 2,
      "product_id": 10,
      "current_quantity": 25,
      "low_stock_threshold": 10,
      "updated_at": "2026-06-06T10:00:00.000Z",
      "product_name": "Coca Cola 330ml",
      "is_low_stock": false
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 5,
  "totalPages": 1,
  "hasNext": false,
  "hasPrev": false
}
```

---

### GET /inventory/low-stock

Returns all inventory records where `current_quantity <= low_stock_threshold`. No pagination — intended as an alert list.

> **Route order matters:** `low-stock` is declared before `/:id` in the controller, otherwise NestJS would interpret the string `low-stock` as an ID parameter.

---

### GET /inventory/:id

Returns a single inventory record with `product_name` and `is_low_stock` joined from the products table.

- `404` if record does not exist.
- `403` if non-admin requests a record belonging to a different shop.

---

### POST /inventory/stock-in

Receives new stock into inventory. Primarily used by the warehouse when products arrive from suppliers, but also available to shop owners for their own shop.

**Request body:**
```json
{
  "productId": 15,
  "quantity": 100,
  "notes": "Supplier delivery"
}
```

**Processing:**
1. Upsert inventory — `INSERT ... ON CONFLICT (shop_id, product_id) DO UPDATE SET current_quantity = current_quantity + excluded.current_quantity`
2. Write audit log: `type = INVENTORY`, `action = STOCK_IN`
3. Commit transaction.

- `quantity` must be a positive integer — cannot stock-in zero or negative.
- Creates the inventory record if it does not yet exist.

---

### PATCH /inventory/:id

Manual inventory adjustment — used for damaged items, recounts, or corrections.

**Request body:**
```json
{
  "adjustment": -5,
  "reason": "Damaged items"
}
```

**Processing:**
1. Load current inventory record.
2. Check access — 403 if shop owner targets another shop's record.
3. Validate `current_quantity + adjustment >= 0` — 400 if it would go negative.
4. Open transaction: update quantity → write audit log → commit.

**Rules:**
- `adjustment` must be a non-zero integer (positive or negative).
- Negative result is blocked before the transaction opens.
- Audit log: `type = INVENTORY`, `action = ADJUSTMENT`, `quantity = adjustment value`.

---

## DTOs

### StockInDto — `src/inventory/dto/stock-in.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `productId` | number | Yes | Positive integer |
| `quantity` | number | Yes | Positive integer |
| `notes` | string | No | Max 500 characters |

### AdjustInventoryDto — `src/inventory/dto/adjust-inventory.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `adjustment` | number | Yes | Non-zero integer (positive or negative) |
| `reason` | string | No | Max 500 characters |

### InventoryQueryDto — `src/inventory/dto/inventory-query.dto.ts`

Extends `PaginationDto` (`page`, `limit`) and adds `lowStock?: boolean` and `productId?: number`.

---

## Audit Log Integration

Every inventory mutation produces one row in `audit_logs`:

| Field | Stock In | Adjustment |
|---|---|---|
| `type` | `INVENTORY` | `INVENTORY` |
| `action` | `STOCK_IN` | `ADJUSTMENT` |
| `entity_type` | `inventory` | `inventory` |
| `entity_id` | inventory record id | inventory record id |
| `quantity` | units added | delta (negative if removal) |
| `notes` | from request body | from `reason` field |
| `shop_id` | user's shop id | record's shop id |
| `user_id` | authenticated user id | authenticated user id |

Both writes happen inside the same database transaction — if either fails, both roll back.

---

## Migration

`10-AddInventoryLowStockThreshold.sql`:
```sql
ALTER TABLE inventory
ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 10;
```

All existing inventory rows automatically get `low_stock_threshold = 10`.

---

## Key Design Decisions

### Why upsert for stock-in?

Requiring the caller to first check whether an inventory record exists before deciding to INSERT or UPDATE adds unnecessary round trips and a race condition window. The upsert (`ON CONFLICT DO UPDATE`) is atomic — one query, no race, no pre-check needed.

### Why block negative stock before opening the transaction?

Calculating `current_quantity + adjustment` in the service before the transaction starts is intentional. It avoids holding a transaction open (and a row lock) while doing validation that can be done in application memory from data already loaded.

### Why is `low-stock` a separate endpoint instead of just `?lowStock=true`?

`GET /inventory?lowStock=true` works for paginated use. `GET /inventory/low-stock` returns an unpaginated list — designed as an alert feed, not a browsable list. Both are supported.

### Pagination with `COUNT(*) OVER()`

The repository uses a PostgreSQL window function to return data and total count in a single query — no separate `SELECT COUNT(*)` needed.

---

## File Map

```
src/inventory/
├── inventory.module.ts                    imports DatabaseModule, AuditLogsModule;
│                                          registers controller, service, repository
├── controllers/
│   └── inventory.controller.ts           GET /inventory, GET /inventory/low-stock,
│                                          GET /inventory/:id, POST /inventory/stock-in,
│                                          PATCH /inventory/:id
├── services/
│   └── inventory.service.ts              findAll, findById, stockIn, adjust, getLowStock
│                                          assertReadAccess(), assertWriteAccess()
├── repositories/
│   └── inventory.repository.ts           findPaginated, findAllForAdmin,
│                                          findById, findLowStock, findAllLowStockForAdmin,
│                                          findByShopAndProduct, upsertStockIn, adjust
├── entities/
│   └── inventory.entity.ts               Inventory: id, shop_id, product_id,
│                                          current_quantity, low_stock_threshold, updated_at
│                                          InventoryWithProduct: extends Inventory +
│                                          product_name, is_low_stock
└── dto/
    ├── stock-in.dto.ts                   productId, quantity, notes?
    ├── adjust-inventory.dto.ts           adjustment (non-zero int), reason?
    └── inventory-query.dto.ts            extends PaginationDto + lowStock?, productId?

src/audit-logs/
├── audit-logs.module.ts                  imports DatabaseModule; exports AuditLogsService
├── entities/
│   └── audit-log.entity.ts              id, shop_id, user_id, type, action,
│                                          entity_type, entity_id, quantity, amount,
│                                          notes, created_at
├── repositories/
│   └── audit-logs.repository.ts         insert(data, client?) — supports tx client
└── services/
    └── audit-logs.service.ts            log(data, client?) — thin wrapper over repo

src/database/migrations/
└── 10-AddInventoryLowStockThreshold.sql
```
