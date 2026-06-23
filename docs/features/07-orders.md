# Orders — Feature Documentation

## Overview

Warehouse ordering flow between shops and the central warehouse. A shop owner creates an order requesting products. The warehouse admin advances the order through a fixed status lifecycle. Inventory transfer — deducting from the warehouse and crediting the shop — happens atomically when the order reaches `RECEIVED`. Every mutation is recorded in `audit_logs`.

---

## Business Rules

- Only `SHOP_OWNER` can create orders.
- `from_shop_id` is always the warehouse. `to_shop_id` is always the requesting shop.
- Orders start as `PENDING` and must advance through statuses in strict linear order.
- Inventory transfer occurs **only** on `RECEIVED` — not on `SHIPPED`. A shipment may be lost, delayed, or rejected before arrival.
- The full inventory transfer (all items, both TRANSFER_OUT and TRANSFER_IN, plus the STATUS_CHANGED audit log) runs inside a single database transaction. If any step fails the entire transaction rolls back.
- `WAREHOUSE_ADMIN` can see and manage all orders. `SHOP_OWNER` and `EMPLOYEE` can only see their own shop's orders.
- Only `WAREHOUSE_ADMIN` can update order status.

---

## Order Lifecycle

```
PENDING → PROCESSING → SHIPPED → RECEIVED → COMPLETED
```

Any other transition returns `400 Bad Request`.

**Example of an invalid transition:**
```
PENDING → SHIPPED   ← 400, must go through PROCESSING first
```

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `POST /orders` | 403 | Own shop | 403 |
| `GET /orders` | All orders | Own shop only | Own shop only |
| `GET /orders/:id` | Any order | Own shop only | Own shop only |
| `PATCH /orders/:id/status` | Any order | 403 | 403 |

---

## Endpoints

### POST /orders

Creates a new order request from the shop to the warehouse.

**Request body:**
```json
{
  "items": [
    { "productId": 10, "quantity": 20 },
    { "productId": 11, "quantity": 5 }
  ]
}
```

**Validation:**
- `items` must be a non-empty array.
- Each `productId` must be a positive integer.
- Each `quantity` must be a positive integer.
- Duplicate `productId` values within the same order are rejected with `400`.
- Each product must exist in the warehouse's inventory — if not, `400` is returned identifying the missing product.

**Processing:**
1. Resolve the warehouse shop (`type = 'WAREHOUSE'`).
2. Validate no duplicate product IDs.
3. Validate each product exists in warehouse inventory.
4. Open transaction: insert order row (`status = PENDING`) → insert order item rows → commit.

**Response:** the created `Order` object.

---

### GET /orders

Returns a paginated list of orders visible to the current user.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `PENDING`, `PROCESSING`, `SHIPPED`, `RECEIVED`, `COMPLETED` |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10) |

**Response shape:**
```json
{
  "data": [
    {
      "id": 6,
      "from_shop_id": 1,
      "to_shop_id": 5,
      "status": "SHIPPED",
      "total_items": 2000,
      "created_at": "2026-06-06T17:33:02.198Z",
      "updated_at": "2026-06-06T17:41:08.645Z"
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

> The list returns order headers only. To see the items and product names, use `GET /orders/:id`.

---

### GET /orders/:id

Returns a single order with its items and product names joined.

**Response shape:**
```json
{
  "id": 6,
  "from_shop_id": 1,
  "to_shop_id": 5,
  "status": "PROCESSING",
  "total_items": 25,
  "created_at": "2026-06-06T17:33:02.198Z",
  "updated_at": "2026-06-06T17:41:08.645Z",
  "items": [
    { "product_id": 10, "product_name": "Coca Cola 330ml", "quantity": 20, "price": 0 },
    { "product_id": 11, "product_name": "Pepsi 500ml", "quantity": 5, "price": 0 }
  ]
}
```

- `404` if order does not exist.
- `403` if non-admin requests an order that does not belong to their shop.

---

### PATCH /orders/:id/status

Advances the order to the next status. `WAREHOUSE_ADMIN` only.

**Request body:**
```json
{ "status": "PROCESSING" }
```

**Validation:** only the immediate next status in the chain is accepted. Anything else returns `400` with a message explaining the current status and what was expected.

**When status becomes `RECEIVED`**, inside the same transaction:
1. For each order item:
   - Check warehouse has sufficient stock — `400` if not.
   - `adjust` warehouse inventory by `-quantity`.
   - `upsertStockIn` shop inventory by `+quantity`.
   - Write `TRANSFER_OUT` audit log for warehouse.
   - Write `TRANSFER_IN` audit log for shop.
2. Write `STATUS_CHANGED` audit log for the order.

**Response:** the updated `Order` object (without items).

---

## Audit Log Integration

| Event | `type` | `action` | `entity_type` | `quantity` | notes |
|---|---|---|---|---|---|
| Status advanced | `ORDER` | `STATUS_CHANGED` | `order` | — | `"PENDING → PROCESSING"` |
| Warehouse deducted | `INVENTORY` | `TRANSFER_OUT` | `inventory` | units removed | `"Order #N — transferred to shop X"` |
| Shop credited | `INVENTORY` | `TRANSFER_IN` | `inventory` | units added | `"Order #N — received from warehouse"` |

All three writes happen inside the same transaction as the status update.

---

## DTOs

### CreateOrderDto — `src/orders/dto/create-order.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `items` | `OrderItemDto[]` | Yes | Non-empty array, each item validated |
| `items[].productId` | number | Yes | Positive integer |
| `items[].quantity` | number | Yes | Positive integer |

### UpdateOrderStatusDto — `src/orders/dto/update-order-status.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `status` | string | Yes | One of the 5 valid `OrderStatus` values |

### OrderQueryDto — `src/orders/dto/order-query.dto.ts`

Extends `PaginationDto` (`page`, `limit`) and adds optional `status` filter.

---

## Key Design Decisions

### Why does inventory transfer only happen on RECEIVED and not SHIPPED?

A shipment can be lost in transit, damaged, or rejected at the door. Deducting warehouse stock on `SHIPPED` would create a gap where the warehouse shows reduced stock but the shop has not actually received anything. `RECEIVED` is the point of confirmed physical handover.

### Why is the entire transfer a single transaction?

If the process deducted warehouse stock for item 1 but then failed on item 2, the data would be left in a partially-transferred, inconsistent state. The transaction wraps all items — if any single step fails, all inventory changes and audit logs roll back.

### Why does the list endpoint not include items?

Joining order items for every row in a paginated list multiplies query cost and response size for a use case that rarely needs item detail. The detail endpoint (`GET /orders/:id`) carries the full payload. This is a standard header/detail split.

### Status transition map

```typescript
const NEXT_STATUS = {
  PENDING: 'PROCESSING',
  PROCESSING: 'SHIPPED',
  SHIPPED: 'RECEIVED',
  RECEIVED: 'COMPLETED',
};
```

A lookup table rather than a chain of `if` statements — easy to read, impossible to accidentally skip a step.

---

## File Map

```
src/orders/
├── orders.module.ts                   imports DatabaseModule, InventoryModule, AuditLogsModule;
│                                      registers controller, service, repository
├── controllers/
│   └── orders.controller.ts          POST /orders, GET /orders, GET /orders/:id,
│                                      PATCH /orders/:id/status
├── services/
│   └── orders.service.ts             createOrder, findAll, findById, updateStatus,
│                                      transferInventory() (private)
├── repositories/
│   └── orders.repository.ts          findWarehouseShop, insert, insertItems,
│                                      findPaginated, findById, updateStatus,
│                                      findItemsByOrderId
├── entities/
│   ├── order.entity.ts               Order: id, from_shop_id, to_shop_id, status,
│   │                                  total_items, created_at, updated_at
│   │                                  OrderWithItems: extends Order + items[]
│   │                                  OrderItemRow: product_id, product_name,
│   │                                  quantity, price
│   └── order-item.entity.ts          OrderItem: id, order_id, product_id, quantity, price
└── dto/
    ├── create-order.dto.ts            items: OrderItemDto[] (productId, quantity)
    ├── update-order-status.dto.ts     status: OrderStatus
    └── order-query.dto.ts             extends PaginationDto + status?

src/inventory/inventory.module.ts      now also exports InventoryRepository
                                       (required by OrdersService for transfer logic)

src/database/migrations/
└── 03-CreateOrdersSystem.sql          orders + order_items tables (pre-existing)
```

---

## Error Keys (i18n)

Translation files: `i18n/en/orders.json`, `i18n/ar/orders.json`

| Key | HTTP | Args | Thrown when |
|---|---|---|---|
| `orders.NOT_FOUND` | 404 | — | Order ID does not exist |
| `orders.SHOP_ID_REQUIRED` | 400 | — | WAREHOUSE_ADMIN creates order without providing `shopId` |
| `orders.WAREHOUSE_NOT_FOUND` | 400 | — | No warehouse shop found in the database |
| `orders.DUPLICATE_PRODUCTS` | 400 | — | Same product appears more than once in order items |
| `orders.PRODUCT_NOT_IN_WAREHOUSE` | 400 | `{productId}` | Ordered product has no warehouse inventory record |
| `orders.OUT_OF_STOCK` | 400 | `{product}` | Product stock is zero |
| `orders.INSUFFICIENT_STOCK` | 400 | `{product}`, `{available}`, `{required}` | Not enough stock for the requested quantity |
| `orders.CANNOT_CANCEL` | 400 | `{status}` | Trying to cancel an order that is SHIPPED, RECEIVED, COMPLETED, or already CANCELLED |
| `orders.CANCEL_OWN_ONLY` | 403 | — | SHOP_OWNER tries to cancel an order not assigned to their shop |
| `orders.CANCEL_PENDING_ONLY` | 403 | — | SHOP_OWNER tries to cancel a non-PENDING order |
| `orders.UPDATE_OWN_ONLY` | 403 | — | SHOP_OWNER tries to update status of an order not assigned to their shop |
| `orders.SHIPPED_TO_RECEIVED_ONLY` | 403 | — | SHOP_OWNER tries a status update other than SHIPPED → RECEIVED |
| `orders.INVALID_STATUS_TRANSITION` | 400 | `{from}`, `{to}`, `{expected}` | Status jump skips the required next state |
| `orders.CONCURRENT_UPDATE` | 409 | — | Optimistic lock failed — another request changed the status first |
| `orders.ACCESS_DENIED` | 403 | — | User tries to read an order not involving their shop |

> Keys with args are thrown using the object form: `throw new BadRequestException({ key, args })`.
> See `docs/features/10-i18n-localization.md` for full details.
