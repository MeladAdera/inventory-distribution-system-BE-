# API Reference — Inventory Distribution System

## Base URL
```
http://localhost:3000
```

## Swagger / Interactive Docs
```
http://localhost:3000/api
```

## Authentication
All protected routes require a JWT Bearer token in the `Authorization` header:
```
Authorization: Bearer <accessToken>
```

## Response Envelope
Every response is wrapped by `TransformInterceptor`:
```json
{
  "data": { ... },       // actual payload
  "statusCode": 200,
  "timestamp": "2026-06-10T12:00:00.000Z"
}
```
Errors follow:
```json
{
  "statusCode": 400,
  "message": "Validation error message",
  "error": "Bad Request"
}
```

## Roles
| Role | Description |
|------|-------------|
| `WAREHOUSE_ADMIN` | Full system access, manages warehouse & shops |
| `SHOP_OWNER` | Manages their own shop, employees, products, orders |
| `EMPLOYEE` | Read-only access within their shop |

---

## Table of Contents
1. [Health](#1-health)
2. [Auth](#2-auth)
3. [Users](#3-users)
4. [Shops](#4-shops)
5. [Categories](#5-categories)
6. [Products](#6-products)
7. [Orders](#7-orders)
8. [Inventory](#8-inventory)
9. [Audit Logs](#9-audit-logs)
10. [Notifications](#10-notifications)

---

## 1. Health

### `GET /`
Public. Returns a hello message.

**Response `200`**
```json
{
  "data": { "message": "Hello World!" },
  "statusCode": 200
}
```

---

### `GET /health`
Public. Returns server health status.

**Response `200`**
```json
{
  "data": { "status": "ok" },
  "statusCode": 200
}
```

---

## 2. Auth

Base path: `/auth`

---

### `POST /auth/login`
Public. **Rate-limited: 5 requests / 60 seconds per IP.**

**Request Body**
```json
{
  "email": "admin@warehouse.com",
  "password": "secret123"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `email` | string | valid email, required |
| `password` | string | min 6 chars, required |

**Response `200`**
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
    "user": {
      "id": 1,
      "shop_id": null,
      "name": "Admin User",
      "email": "admin@warehouse.com",
      "role": "WAREHOUSE_ADMIN",
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-06-01T00:00:00.000Z"
    }
  },
  "statusCode": 200
}
```

**Error `401`** — wrong credentials
```json
{ "statusCode": 401, "message": "Invalid credentials" }
```

**Error `429`** — rate limit exceeded
```json
{ "statusCode": 429, "message": "Too Many Requests" }
```

---

### `POST /auth/refresh`
Public. Rotates a refresh token (old token is invalidated).

**Request Body**
```json
{
  "refreshToken": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4..."
}
```

**Response `200`**
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "bmV3UmVmcmVzaFRva2Vu..."
  },
  "statusCode": 200
}
```

**Error `401`** — invalid or expired refresh token

---

### `POST /auth/logout`
**Auth required.** Revokes all refresh tokens for the current user.

**Response `204`** — No Content

---

### `GET /auth/me`
**Auth required.** Returns the currently authenticated user.

**Response `200`**
```json
{
  "data": {
    "id": 1,
    "shop_id": 2,
    "name": "John Owner",
    "email": "john@shop.com",
    "role": "SHOP_OWNER",
    "is_active": true
  },
  "statusCode": 200
}
```

---

## 3. Users

Base path: `/users` — **Auth required on all routes**

---

### `POST /users/shop-owners`
**Roles:** `WAREHOUSE_ADMIN`

Creates a new shop and its owner account in one request.

**Request Body**
```json
{
  "shopName": "Downtown Retail",
  "shopAddress": "123 Main St",
  "ownerName": "Jane Doe",
  "email": "jane@downtown.com",
  "password": "secret123"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `shopName` | string | required |
| `shopAddress` | string | optional |
| `ownerName` | string | required |
| `email` | string | valid email, required |
| `password` | string | min 6 chars, required |

**Response `201`**
```json
{
  "data": {
    "id": 5,
    "shop_id": 3,
    "name": "Jane Doe",
    "email": "jane@downtown.com",
    "role": "SHOP_OWNER",
    "is_active": true,
    "created_at": "2026-06-10T10:00:00.000Z",
    "updated_at": "2026-06-10T10:00:00.000Z"
  },
  "statusCode": 201
}
```

---

### `POST /users/employees`
**Roles:** `SHOP_OWNER`

Creates an employee account within the authenticated owner's shop.

**Request Body**
```json
{
  "name": "Bob Smith",
  "email": "bob@downtown.com",
  "password": "secret123"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | required |
| `email` | string | valid email, required |
| `password` | string | min 6 chars, required |

**Response `201`** — same shape as `SafeUser` above, with `role: "EMPLOYEE"`

---

### `GET /users`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Returns a paginated list of users. `SHOP_OWNER` only sees users in their own shop.

**Query Parameters**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `role` | string | — | Filter by role: `WAREHOUSE_ADMIN` \| `SHOP_OWNER` \| `EMPLOYEE` |
| `shop_id` | number | — | Filter by shop (WAREHOUSE_ADMIN only) |
| `search` | string | — | Search by name or email |

**Response `200`**
```json
{
  "data": {
    "data": [
      {
        "id": 2,
        "shop_id": 1,
        "name": "Alice",
        "email": "alice@shop.com",
        "role": "EMPLOYEE",
        "is_active": true,
        "created_at": "2026-01-15T00:00:00.000Z",
        "updated_at": "2026-01-15T00:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  },
  "statusCode": 200
}
```

---

### `GET /users/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

**Response `200`** — single `SafeUser` object

**Error `404`** — user not found

---

### `PATCH /users/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

**Request Body** (all fields optional)
```json
{
  "name": "Alice Updated",
  "email": "alice.new@shop.com"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | optional, min 2 chars |
| `email` | string | optional, valid email |

**Response `200`** — updated `SafeUser`

---

### `DELETE /users/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Soft-deletes the user (sets `is_active = false`).

**Response `204`** — No Content

---

## 4. Shops

Base path: `/shops` — **Auth required on all routes**

---

### `GET /shops`
**Roles:** All authenticated users

Returns all shops. `SHOP_OWNER` and `EMPLOYEE` see only their own shop.

**Response `200`**
```json
{
  "data": [
    {
      "id": 1,
      "name": "Main Warehouse",
      "address": "Warehouse District",
      "phone": "+1-555-0100",
      "type": "WAREHOUSE",
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": 2,
      "name": "Downtown Retail",
      "address": "123 Main St",
      "phone": null,
      "type": "RETAIL",
      "is_active": true,
      "created_at": "2026-02-01T00:00:00.000Z",
      "updated_at": "2026-02-01T00:00:00.000Z"
    }
  ],
  "statusCode": 200
}
```

---

### `GET /shops/:id`
**Roles:** All authenticated users

**Response `200`** — single `Shop` object

**Error `404`** — shop not found

---

### `PATCH /shops/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

**Request Body** (all optional)
```json
{
  "name": "Renamed Shop",
  "address": "456 New Ave",
  "phone": "+1-555-0101"
}
```

**Response `200`** — updated `Shop`

---

### `PATCH /shops/:id/status`
**Roles:** `WAREHOUSE_ADMIN`

Activates or deactivates a shop.

**Request Body**
```json
{
  "isActive": false
}
```

**Response `200`** — updated `Shop` with new `is_active` value

---

## 5. Categories

Base path: `/categories` — **Auth required on all routes**

---

### `GET /categories`
**Roles:** All authenticated users

**Query Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `shopId` | number | Optional — filter categories by shop |

**Response `200`**
```json
{
  "data": [
    {
      "id": 1,
      "shop_id": 1,
      "name": "Electronics",
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  ],
  "statusCode": 200
}
```

---

### `GET /categories/:id`
**Roles:** All authenticated users

**Response `200`** — single `Category`

**Error `404`** — category not found

---

### `POST /categories`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

**Query Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `shopId` | number | Optional override — which shop to create for (WAREHOUSE_ADMIN only) |

**Request Body**
```json
{
  "name": "Beverages"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | 3–100 chars, required |

**Response `201`** — created `Category`

---

### `PATCH /categories/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

**Request Body**
```json
{
  "name": "Soft Drinks"
}
```

**Response `200`** — updated `Category`

---

### `DELETE /categories/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

**Response `204`** — No Content

---

## 6. Products

Base path: `/products` — **Auth required on all routes**

---

### `GET /products`
**Roles:** All authenticated users

**Query Parameters**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `source` | string | — | `WAREHOUSE` or `LOCAL` |
| `category_id` | number | — | Filter by category |
| `shop_id` | number | — | Filter by shop (WAREHOUSE_ADMIN only) |

**Response `200`**
```json
{
  "data": {
    "data": [
      {
        "id": 1,
        "shop_id": 1,
        "category_id": 2,
        "name": "Laptop Pro",
        "description": "High-performance laptop",
        "barcode": "1234567890123",
        "price": 999.99,
        "source": "WAREHOUSE",
        "is_global": true,
        "is_active": true,
        "created_at": "2026-01-10T00:00:00.000Z",
        "updated_at": "2026-01-10T00:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  },
  "statusCode": 200
}
```

---

### `GET /products/:id`
**Roles:** All authenticated users

**Response `200`** — single `Product`

**Error `404`** — product not found

---

### `POST /products`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

**Query Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `shop_id` | number | Optional — which shop (WAREHOUSE_ADMIN only) |

**Request Body**
```json
{
  "name": "Wireless Mouse",
  "description": "Ergonomic wireless mouse",
  "barcode": "9876543210123",
  "price": 29.99,
  "category_id": 1
}
```

| Field | Type | Rules |
|-------|------|-------|
| `name` | string | 3–150 chars, required |
| `description` | string | optional |
| `barcode` | string | optional |
| `price` | number | required, > 0, max 2 decimal places |
| `category_id` | number | required, must reference existing category |

**Response `201`** — created `Product`

---

### `PATCH /products/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

**Request Body** (all optional)
```json
{
  "name": "Wireless Mouse v2",
  "price": 34.99
}
```

**Response `200`** — updated `Product`

---

### `DELETE /products/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Soft-deletes the product (`is_active = false`).

**Response `204`** — No Content

---

## 7. Orders

Base path: `/orders` — **Auth required on all routes**

---

### `POST /orders`
**Roles:** `SHOP_OWNER`

Creates a new order request from the shop to the warehouse.

**Request Body**
```json
{
  "items": [
    { "productId": 1, "quantity": 10 },
    { "productId": 3, "quantity": 5 }
  ]
}
```

| Field | Type | Rules |
|-------|------|-------|
| `items` | array | required, min 1 item |
| `items[].productId` | number | > 0, required |
| `items[].quantity` | number | > 0, required |

**Response `201`**
```json
{
  "data": {
    "id": 12,
    "from_shop_id": 2,
    "to_shop_id": 1,
    "status": "PENDING",
    "total_items": 2,
    "created_at": "2026-06-10T09:00:00.000Z",
    "updated_at": "2026-06-10T09:00:00.000Z"
  },
  "statusCode": 201
}
```

---

### `GET /orders`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE`

**Query Parameters**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `status` | string | — | Filter: `PENDING` \| `PROCESSING` \| `SHIPPED` \| `RECEIVED` \| `COMPLETED` |

**Response `200`**
```json
{
  "data": {
    "data": [
      {
        "id": 12,
        "from_shop_id": 2,
        "to_shop_id": 1,
        "status": "PENDING",
        "total_items": 2,
        "created_at": "2026-06-10T09:00:00.000Z",
        "updated_at": "2026-06-10T09:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  },
  "statusCode": 200
}
```

---

### `GET /orders/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE`

Returns the order with its line items.

**Response `200`**
```json
{
  "data": {
    "id": 12,
    "from_shop_id": 2,
    "to_shop_id": 1,
    "status": "PENDING",
    "total_items": 2,
    "created_at": "2026-06-10T09:00:00.000Z",
    "updated_at": "2026-06-10T09:00:00.000Z",
    "items": [
      {
        "product_id": 1,
        "product_name": "Laptop Pro",
        "quantity": 10,
        "price": 999.99
      },
      {
        "product_id": 3,
        "product_name": "Wireless Mouse",
        "quantity": 5,
        "price": 29.99
      }
    ]
  },
  "statusCode": 200
}
```

---

### `PATCH /orders/:id/status`
**Roles:** `WAREHOUSE_ADMIN`

Moves an order through its lifecycle.

**Order Status Flow**
```
PENDING → PROCESSING → SHIPPED → RECEIVED → COMPLETED
```

**Request Body**
```json
{
  "status": "PROCESSING"
}
```

| Field | Type | Values |
|-------|------|--------|
| `status` | string | `PENDING` \| `PROCESSING` \| `SHIPPED` \| `RECEIVED` \| `COMPLETED` |

**Response `200`** — updated `Order`

**Error `400`** — invalid status transition

---

## 8. Inventory

Base path: `/inventory` — **Auth required on all routes**

---

### `GET /inventory`
**Roles:** All authenticated users

**Query Parameters**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `lowStock` | boolean | — | If `true`, return only low-stock items |
| `productId` | number | — | Filter by product |

**Response `200`**
```json
{
  "data": {
    "data": [
      {
        "id": 1,
        "shop_id": 1,
        "product_id": 1,
        "current_quantity": 50,
        "low_stock_threshold": 10,
        "updated_at": "2026-06-09T00:00:00.000Z",
        "product_name": "Laptop Pro",
        "is_low_stock": false
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  },
  "statusCode": 200
}
```

---

### `GET /inventory/low-stock`
**Roles:** All authenticated users

Returns all inventory items below their `low_stock_threshold`.

**Response `200`**
```json
{
  "data": [
    {
      "id": 3,
      "shop_id": 2,
      "product_id": 5,
      "current_quantity": 2,
      "low_stock_threshold": 10,
      "updated_at": "2026-06-10T08:00:00.000Z",
      "product_name": "USB Cable",
      "is_low_stock": true
    }
  ],
  "statusCode": 200
}
```

---

### `GET /inventory/:id`
**Roles:** All authenticated users

**Response `200`**
```json
{
  "data": {
    "id": 1,
    "shop_id": 1,
    "product_id": 1,
    "current_quantity": 50,
    "low_stock_threshold": 10,
    "updated_at": "2026-06-09T00:00:00.000Z"
  },
  "statusCode": 200
}
```

---

### `POST /inventory/stock-in`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Adds stock to a product's inventory record. Creates the record if it doesn't exist.

**Request Body**
```json
{
  "productId": 1,
  "quantity": 100,
  "notes": "Initial stock from supplier"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `productId` | number | > 0, required |
| `quantity` | number | > 0, required |
| `notes` | string | optional, max 500 chars |

**Response `201`**
```json
{
  "data": {
    "id": 1,
    "shop_id": 1,
    "product_id": 1,
    "current_quantity": 150,
    "low_stock_threshold": 10,
    "updated_at": "2026-06-10T10:00:00.000Z"
  },
  "statusCode": 201
}
```

---

### `PATCH /inventory/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Manually adjusts the quantity of an inventory record (positive = add, negative = subtract).

**Request Body**
```json
{
  "adjustment": -5,
  "reason": "Damaged goods removed"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `adjustment` | number | required, cannot be 0 (positive or negative) |
| `reason` | string | optional, max 500 chars |

**Response `200`** — updated `Inventory`

**Error `400`** — adjustment would make quantity negative

---

## 9. Audit Logs

Base path: `/audit-logs` — **Auth required on all routes**

---

### `GET /audit-logs`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE`

**Query Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10) |
| `shopId` | number | Filter by shop |
| `userId` | number | Filter by user who performed the action |
| `type` | string | Log type, e.g. `INVENTORY`, `ORDER`, `USER` |
| `action` | string | Specific action, e.g. `STOCK_IN`, `STATUS_UPDATE`, `CREATE` |
| `entityType` | string | Entity type, e.g. `inventory`, `order`, `product` |
| `entityId` | number | Specific entity ID |
| `fromDate` | string | ISO date, e.g. `2026-06-01` |
| `toDate` | string | ISO date, e.g. `2026-06-30` |

**Response `200`**
```json
{
  "data": {
    "data": [
      {
        "id": 101,
        "shop_id": 1,
        "user_id": 2,
        "type": "INVENTORY",
        "action": "STOCK_IN",
        "entity_type": "inventory",
        "entity_id": 1,
        "quantity": 100,
        "amount": null,
        "notes": "Initial stock from supplier",
        "created_at": "2026-06-10T10:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  },
  "statusCode": 200
}
```

---

### `GET /audit-logs/:id`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE`

**Response `200`** — single `AuditLog` record

**Error `404`** — log not found

---

## 10. Notifications

Base path: `/notifications` — **Auth required on all routes**

---

### `GET /notifications`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE`

Returns notifications for the authenticated user's shop.

**Query Parameters**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page |
| `isRead` | boolean | — | `true` to get read-only, `false` for unread-only |

**Response `200`**
```json
{
  "data": {
    "data": [
      {
        "id": 7,
        "shop_id": 2,
        "user_id": null,
        "title": "Low Stock Alert",
        "message": "USB Cable is running low (2 remaining)",
        "type": "LOW_STOCK",
        "is_read": false,
        "created_at": "2026-06-10T08:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  },
  "statusCode": 200
}
```

---

### `PATCH /notifications/read-all`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE`

Marks all of the current user's notifications as read.

**Response `200`**
```json
{
  "data": { "updated": 5 },
  "statusCode": 200
}
```

---

### `PATCH /notifications/:id/read`
**Roles:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE`

Marks a single notification as read.

**Response `200`**
```json
{
  "data": {
    "id": 7,
    "shop_id": 2,
    "user_id": null,
    "title": "Low Stock Alert",
    "message": "USB Cable is running low (2 remaining)",
    "type": "LOW_STOCK",
    "is_read": true,
    "created_at": "2026-06-10T08:00:00.000Z"
  },
  "statusCode": 200
}
```

**Error `404`** — notification not found

---

## Enums Reference

### `UserRole`
| Value | Description |
|-------|-------------|
| `WAREHOUSE_ADMIN` | System administrator, manages all shops |
| `SHOP_OWNER` | Manages a single retail shop |
| `EMPLOYEE` | Shop employee with read-only access |

### `OrderStatus`
| Value | Description |
|-------|-------------|
| `PENDING` | Order submitted, awaiting warehouse review |
| `PROCESSING` | Warehouse is preparing the order |
| `SHIPPED` | Order is in transit |
| `RECEIVED` | Shop confirmed receipt |
| `COMPLETED` | Order fully closed |

### `ProductSource`
| Value | Description |
|-------|-------------|
| `WAREHOUSE` | Product originates from the central warehouse |
| `LOCAL` | Product is local to a retail shop only |

### `ShopType`
| Value | Description |
|-------|-------------|
| `WAREHOUSE` | The central warehouse |
| `RETAIL` | A retail shop |

---

## Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | OK — successful GET or PATCH |
| `201` | Created — successful POST |
| `204` | No Content — successful DELETE or logout |
| `400` | Bad Request — validation failed or invalid input |
| `401` | Unauthorized — missing or invalid JWT |
| `403` | Forbidden — authenticated but insufficient role |
| `404` | Not Found — resource does not exist |
| `409` | Conflict — duplicate entry (e.g., email already in use) |
| `429` | Too Many Requests — rate limit hit on login |

---

## CORS

| Setting | Value |
|---------|-------|
| Allowed Origin | `http://localhost:3001` (configurable via `ALLOWED_ORIGINS` env) |
| Allowed Methods | `GET, POST, PATCH, DELETE, OPTIONS` |
| Allowed Headers | `Content-Type, Authorization` |
| Credentials | Enabled |

> Set your frontend dev server to run on port **3001** to avoid CORS issues.
