# Audit Logs & Notifications — Feature Documentation

## Overview

Two separate but related concerns implemented together:

**Audit Logs** — the append-only history table (`audit_logs`) already existed and was written to by Inventory and Orders. This ticket exposes it through query APIs so users can browse and filter the history.

**Notifications** — the `notifications` table already existed in the schema. This ticket wires up a real `NotificationsService` with three trigger points (order created, order status changed, low stock) and exposes read/mark-read endpoints.

---

## Audit Logs

### Business Rules

- Audit logs are immutable — they can never be updated or deleted via API.
- `WAREHOUSE_ADMIN` sees logs for all shops.
- `SHOP_OWNER` and `EMPLOYEE` see only logs where `shop_id` matches their shop. Even if they pass `?shopId=X` in the query, the service overrides it with their own shop ID.
- All existing inventory and order operations already write to `audit_logs` — no new write paths were added in this ticket.

### Existing Audit Log Sources

| Module | `type` | `action` |
|---|---|---|
| Inventory | `INVENTORY` | `STOCK_IN` |
| Inventory | `INVENTORY` | `ADJUSTMENT` |
| Orders (on RECEIVED) | `INVENTORY` | `TRANSFER_OUT` |
| Orders (on RECEIVED) | `INVENTORY` | `TRANSFER_IN` |
| Orders | `ORDER` | `STATUS_CHANGED` |

### Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `GET /audit-logs` | All shops | Own shop only | Own shop only |
| `GET /audit-logs/:id` | Any record | Own shop only (403 otherwise) | Own shop only (403 otherwise) |

---

### Endpoints

#### GET /audit-logs

Returns a paginated list of audit logs filtered by the current user's access scope.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `shopId` | number | Filter by shop (admin only — ignored for non-admins) |
| `userId` | number | Filter by the user who performed the action |
| `type` | string | `INVENTORY` or `ORDER` |
| `action` | string | e.g. `STOCK_IN`, `STATUS_CHANGED`, `TRANSFER_OUT` |
| `entityType` | string | `inventory` or `order` |
| `entityId` | number | ID of the specific record |
| `fromDate` | string | Start date inclusive (`YYYY-MM-DD`) |
| `toDate` | string | End date inclusive (`YYYY-MM-DD`) |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10) |

**Response shape:**
```json
{
  "data": [
    {
      "id": 12,
      "shop_id": 1,
      "user_id": 1,
      "type": "INVENTORY",
      "action": "STOCK_IN",
      "entity_type": "inventory",
      "entity_id": 3,
      "quantity": 100,
      "amount": null,
      "notes": "Initial stock",
      "created_at": "2026-06-07T10:00:00.000Z"
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

#### GET /audit-logs/:id

Returns a single audit log record.

- `404` if not found.
- `403` if non-admin requests a record from a different shop.

---

## Notifications

### Business Rules

- Notifications are shop-scoped (`shop_id`) — all members of a shop share the same notification feed.
- Notifications can be marked read but not deleted or modified otherwise.
- Three trigger points create notifications automatically:
  1. **Order created** → notification in the warehouse feed
  2. **Order status changed** → notification in the requesting shop's feed
  3. **Low stock** → notification in the affected shop's feed
- **Low-stock de-duplication:** before creating a LOW_STOCK notification, the service checks if an unread LOW_STOCK notification with the same title already exists for the shop. If one exists, no duplicate is created. Once the user marks it as read, a new alert can be generated the next time stock drops below threshold.
- Notification triggers are called **outside** the database transaction that performs the business operation. A notification insert failure never rolls back the inventory change or order update.

### Notification Types

| `type` | Trigger | Recipient |
|---|---|---|
| `ORDER_CREATED` | `POST /orders` | Warehouse shop |
| `ORDER_STATUS` | `PATCH /orders/:id/status` | Requesting shop |
| `LOW_STOCK` | `POST /inventory/stock-in` or `PATCH /inventory/:id` when result is below threshold | Affected shop |

### Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `GET /notifications` | Warehouse feed | Own shop feed | Own shop feed |
| `PATCH /notifications/:id/read` | Warehouse feed | Own shop feed | Own shop feed |
| `PATCH /notifications/read-all` | Warehouse feed | Own shop feed | Own shop feed |

---

### Endpoints

#### GET /notifications

Returns a paginated list of notifications for the current user's shop.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `isRead` | boolean | `true` → only read. `false` → only unread. Omit for all. |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10) |

**Response shape:**
```json
{
  "data": [
    {
      "id": 3,
      "shop_id": 5,
      "user_id": null,
      "title": "Order #6 Updated",
      "message": "Order #6 is now PROCESSING.",
      "type": "ORDER_STATUS",
      "is_read": false,
      "created_at": "2026-06-07T10:00:00.000Z"
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

#### PATCH /notifications/read-all

Marks all unread notifications as read for the current user's shop.

**Response:** `{ "success": true }`

#### PATCH /notifications/:id/read

Marks a single notification as read.

- `404` if the notification is not found within the user's shop.

**Response:** `{ "success": true }`

---

## DTOs

### AuditLogQueryDto — `src/audit-logs/dto/audit-log-query.dto.ts`

Extends `PaginationDto` and adds: `shopId?`, `userId?`, `type?`, `action?`, `entityType?`, `entityId?`, `fromDate?`, `toDate?`.

### NotificationQueryDto — `src/notifications/dto/notification-query.dto.ts`

Extends `PaginationDto` and adds: `isRead?: boolean`.

---

## Key Design Decisions

### Why are notification triggers outside the transaction?

If `notifyOrderCreated()` throws, the order was already committed. Wrapping the notification inside the transaction would roll back the order — a disproportionate consequence for a secondary concern. Notifications are best-effort; business data is not.

### Why is low-stock de-duplication based on unread status?

Checking for any existing LOW_STOCK notification (read or unread) would mean only one ever gets created per product per shop. Using unread status allows the cycle to repeat naturally: once the team acknowledges the alert by reading it, the system can fire again if stock drops again after a restock.

### Why does `findAll` in AuditLogsService ignore `query.shopId` for non-admins?

Non-admin users could craft a request with `?shopId=1` to try to read warehouse logs. The service resolves `scopedShopId` from the JWT token, not the query string, and passes it to the repository where it is applied unconditionally — the query param is silently ignored.

### Why is `PATCH /notifications/read-all` declared before `/:id/read`?

NestJS matches routes top-to-bottom. If `/:id/read` were declared first, the string `read-all` would be interpreted as the `:id` param and `ParseIntPipe` would throw a 400. The specific route must come before the parameterised one.

---

## File Map

```
src/audit-logs/
├── audit-logs.module.ts               imports DatabaseModule; exports AuditLogsService
├── controllers/
│   └── audit-logs.controller.ts      GET /audit-logs, GET /audit-logs/:id
├── dto/
│   └── audit-log-query.dto.ts        extends PaginationDto + 8 optional filters
├── repositories/
│   └── audit-logs.repository.ts      insert (existing), findPaginated, findById
└── services/
    └── audit-logs.service.ts         log (existing), findAll, findById

src/notifications/
├── notifications.module.ts            imports DatabaseModule; exports NotificationsService
├── controllers/
│   └── notifications.controller.ts   GET /notifications,
│                                      PATCH /notifications/read-all,
│                                      PATCH /notifications/:id/read
├── dto/
│   └── notification-query.dto.ts     extends PaginationDto + isRead?
├── entities/
│   └── notification.entity.ts        id, shop_id, user_id, title, message,
│                                      type, is_read, created_at
├── repositories/
│   └── notifications.repository.ts   insert, findPaginatedForShop,
│                                      markRead, markAllRead, hasUnreadLowStock
└── services/
    └── notifications.service.ts      findAll, markRead, markAllRead,
                                       notifyOrderCreated, notifyStatusChanged,
                                       notifyLowStock

src/orders/
├── orders.module.ts                   now also imports NotificationsModule
└── services/
    └── orders.service.ts             createOrder → notifyOrderCreated
                                       updateStatus → notifyStatusChanged

src/inventory/
├── inventory.module.ts                now also imports NotificationsModule
└── services/
    └── inventory.service.ts          stockIn → notifyLowStock (if is_low_stock)
                                       adjust  → notifyLowStock (if is_low_stock)
```
