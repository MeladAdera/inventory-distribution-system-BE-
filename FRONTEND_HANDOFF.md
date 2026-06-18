# Frontend Handoff — Inventory & Distribution System

> **Status:** Backend API is complete and ready for integration.  
> **Base URL (dev):** `http://localhost:3000`  
> **API Docs (Swagger):** `http://localhost:3000/api`

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Roles & Permissions](#2-roles--permissions)
3. [Authentication](#3-authentication)
4. [API Endpoints](#4-api-endpoints)
   - [Auth](#auth)
   - [Users](#users)
   - [Shops](#shops)
   - [Products](#products)
   - [Categories](#categories)
   - [Inventory](#inventory)
   - [Orders](#orders)
   - [Notifications](#notifications)
   - [Audit Logs](#audit-logs)
   - [Analytics](#analytics)
5. [Pagination](#5-pagination)
6. [Response Format](#6-response-format)
7. [Error Format](#7-error-format)
8. [Domain Concepts & Enums](#8-domain-concepts--enums)
9. [UI Flows & Suggested Pages](#9-ui-flows--suggested-pages)

---

## 1. System Overview

This is a multi-tenant **Inventory & Distribution System** with one central warehouse and multiple retail shops.

```
WAREHOUSE  ──(ships orders)──►  SHOP A
                              ►  SHOP B
                              ►  SHOP C
```

- The **Warehouse Admin** manages the whole system: creates shops, manages stock, approves/ships orders.
- **Shop Owners** manage their own shop: create employees, manage local inventory, place orders to the warehouse.
- **Employees** have read/limited access within their shop.

---

## 2. Roles & Permissions

| Role | Value | Description |
|------|-------|-------------|
| Warehouse Admin | `WAREHOUSE_ADMIN` | Full system access; manages all shops |
| Shop Owner | `SHOP_OWNER` | Manages their single shop and its employees |
| Employee | `EMPLOYEE` | Read access + limited shop operations |

**Key rules:**
- Each user belongs to one `shop_id` (set at creation).
- Non-admin users can only see/modify data belonging to their own shop.
- Warehouse Admin can see and manage everything across all shops.

---

## 3. Authentication

### Login

```
POST /auth/login
Content-Type: application/json

{
  "email": "admin@warehouse.com",
  "password": "secret"
}
```

**Response `200`:**
```json
{
  "accessToken": "<JWT — expires in 15 min>",
  "refreshToken": "<UUID — expires in 30 days>",
  "user": {
    "id": 1,
    "name": "Admin",
    "email": "admin@warehouse.com",
    "role": "WAREHOUSE_ADMIN",
    "shopId": 1
  }
}
```

Store both tokens. Use `accessToken` for API calls. Use `refreshToken` only to renew the access token.

### Using the Access Token

Add to every protected request:
```
Authorization: Bearer <accessToken>
```

### Refreshing the Access Token

When a request returns `401`, call refresh to get a new pair:

```
POST /auth/refresh
Content-Type: application/json

{ "refreshToken": "<stored refreshToken>" }
```

**Response `200`:**
```json
{
  "accessToken": "<new JWT>",
  "refreshToken": "<new UUID — old one is now dead>"
}
```

> **Rotation:** every refresh call invalidates the old refresh token. Always save the new one.

### Logout

```
POST /auth/logout
Authorization: Bearer <accessToken>
```

**Response `204 No Content`** — clears all active sessions for the user (all devices).
After logout, delete both tokens from storage and redirect to `/login`.

### Get Current User

```
GET /auth/me
Authorization: Bearer <accessToken>
```

**Response `200`:**
```json
{
  "id": 1,
  "email": "admin@warehouse.com",
  "role": "WAREHOUSE_ADMIN",
  "shopId": 1
}
```

> Note: this response comes from the JWT payload — it does **not** include `name`. Use the `name` from the login response or fetch it from `GET /users/:id`.

### Token Lifecycle (what to implement in the HTTP client)

```
Request → 401?
  yes → POST /auth/refresh
          success → retry original request with new accessToken
          401     → tokens expired or user logged out → redirect to /login
  no  → handle normally
```

### Rate Limiting

- Login is limited to **5 attempts per minute** per IP. Show a friendly message on 429.
- Global API limit: 100 requests / 60 seconds.

---

## 4. API Endpoints

### Auth

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/auth/login` | No | — | Login — returns accessToken + refreshToken + user |
| POST | `/auth/refresh` | No | — | Rotate refresh token, get new access token |
| POST | `/auth/logout` | JWT | All | Revoke all refresh tokens (all devices) → 204 |
| GET | `/auth/me` | JWT | All | Get current user info |

---

### Users

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/users/shop-owners` | JWT | `WAREHOUSE_ADMIN` | Create a new shop + its owner in one request |
| POST | `/users/employees` | JWT | `SHOP_OWNER` | Create an employee for your shop |
| GET | `/users` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | List users (filterable) |
| GET | `/users/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Get a single user |
| PATCH | `/users/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Update name/email |
| DELETE | `/users/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Soft-deactivate a user |

**Create Shop Owner** `POST /users/shop-owners`
```json
{
  "shopName": "Cairo Branch",
  "shopAddress": "123 Main St",
  "ownerName": "Ahmed Hassan",
  "email": "ahmed@cairo.com",
  "password": "password123"
}
```
> `shopAddress` is optional.

**Create Employee** `POST /users/employees`
```json
{
  "name": "Sara Ali",
  "email": "sara@cairo.com",
  "password": "password123"
}
```

**Query Params for** `GET /users`

| Param | Type | Description |
|-------|------|-------------|
| `role` | string | Filter by `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE` |
| `shop_id` | number | Filter by shop (admin only) |
| `search` | string | Search by name or email |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10, max: 100) |

**User Object:**
```json
{
  "id": 5,
  "shop_id": 2,
  "shop_name": "Cairo Branch",
  "name": "Sara Ali",
  "email": "sara@cairo.com",
  "role": "EMPLOYEE",
  "is_active": true,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
}
```

---

### Shops

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/shops` | JWT | All | List shops (admin: all; others: own shop only) |
| GET | `/shops/:id` | JWT | All | Get shop details |
| PATCH | `/shops/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Update shop info |
| PATCH | `/shops/:id/status` | JWT | `WAREHOUSE_ADMIN` | Activate / deactivate a shop |

**Shop Object:**
```json
{
  "id": 2,
  "name": "Cairo Branch",
  "address": "123 Main St",
  "phone": "+20100000000",
  "type": "SHOP",
  "is_active": true,
  "created_at": "2025-01-01T00:00:00Z"
}
```

> `type` is either `"WAREHOUSE"` (the main warehouse) or `"SHOP"` (retail branch).

> **`GET /shops` response shape depends on role:**
> - `WAREHOUSE_ADMIN` → `data` is a **`Shop[]` array** (all shops, no pagination)
> - `SHOP_OWNER` / `EMPLOYEE` → `data` is a **single `Shop` object** (their own shop only)
>
> `GET /shops` does **not** support `page` / `limit` query params.

**Update Shop** `PATCH /shops/:id`
```json
{
  "name": "Cairo Branch Updated",
  "address": "456 New St",
  "phone": "+20100000001"
}
```

**Update Status** `PATCH /shops/:id/status`
```json
{ "isActive": false }
```

---

### Products

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/products` | JWT | All | List products (filterable) |
| GET | `/products/:id` | JWT | All | Get single product |
| POST | `/products` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Create product |
| PATCH | `/products/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Update product |
| DELETE | `/products/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Soft-delete product → `204 No Content` |

**Create Product** `POST /products`
```json
{
  "name": "Laptop 15\"",
  "description": "Core i7 laptop",
  "barcode": "1234567890",
  "price": 1200.00,
  "category_id": 3
}
```

**Query Params for** `GET /products`

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Case-insensitive search by product name or barcode |
| `source` | string | `WAREHOUSE` or `LOCAL` |
| `category_name` | string | Case-insensitive substring match on category name |
| `shop_id` | number | Admin only — filter by specific shop ID |
| `shop_name` | string | Admin only — case-insensitive partial match on shop name (e.g. `?shop_name=melad` matches "Melad Market") |
| `is_active` | boolean | Admin only — `false` to include soft-deleted products (default: active only) |
| `stock_status` | string | `OUT_OF_STOCK` \| `LOW_STOCK` \| `HIGH_STOCK` — relative to each product's threshold |
| `page` / `limit` | number | Pagination |

> **Admin-only params:** `shop_id`, `shop_name`, and `is_active` are silently ignored for `SHOP_OWNER` and `EMPLOYEE` roles.

**`source` values explained:**

| Value | Meaning |
|-------|---------|
| `WAREHOUSE` | Product created by the warehouse admin — visible to all shops |
| `LOCAL` | Product created by a specific shop — visible only to that shop |

> `source` is set automatically by the backend based on who creates the product. It cannot be set manually.

**Filter examples (admin):**
```
GET /products?shop_name=melad                    → all products belonging to Melad Market
GET /products?shop_name=melad&source=LOCAL       → only products Melad Market created itself
GET /products?shop_name=melad&source=WAREHOUSE   → only warehouse products visible to Melad Market
GET /products?source=LOCAL                       → all shop-created products across all shops
GET /products?stock_status=LOW_STOCK&shop_name=melad → low-stock items in Melad Market
```

**Product Object (list):**
```json
{
  "id": 10,
  "shop_id": 1,
  "category_id": 3,
  "category_name": "Electronics",
  "name": "Laptop 15\"",
  "description": "Core i7 laptop",
  "barcode": "1234567890",
  "price": "1200.00",
  "source": "WAREHOUSE",
  "is_global": true,
  "is_active": true,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
}
```

**Product Object (single — `GET /products/:id`):**

Same fields as above, plus `current_quantity` from the inventory table:
```json
{
  "id": 10,
  "shop_id": 1,
  "category_id": 3,
  "category_name": "Electronics",
  "name": "Laptop 15\"",
  "description": "Core i7 laptop",
  "barcode": "1234567890",
  "price": "1200.00",
  "source": "WAREHOUSE",
  "is_global": true,
  "is_active": true,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z",
  "current_quantity": 42
}
```

> `source: "WAREHOUSE"` — product defined at the warehouse level.  
> `source: "LOCAL"` — product defined by a shop.  
> `current_quantity` — returns `0` if no inventory record exists yet for this product.

---

### Categories

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/categories` | JWT | All | List categories |
| GET | `/categories/:id` | JWT | All | Get single category |
| POST | `/categories` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Create category |
| PATCH | `/categories/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Rename category |
| DELETE | `/categories/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Delete (fails if products exist) → `204 No Content` |

**Query Params for** `GET /categories`

| Param | Type | Description |
|-------|------|-------------|
| `shopId` | number | Admin only — filter by specific shop |

**Create/Update Category:**
```json
{ "name": "Electronics" }
```

**Category Object:**
```json
{
  "id": 3,
  "shop_id": 1,
  "name": "Electronics",
  "created_at": "2025-01-01T00:00:00Z"
}
```

> Non-admin users see: their own shop's categories **+** warehouse categories.

---

### Inventory

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/inventory` | JWT | All | List inventory items |
| GET | `/inventory/low-stock` | JWT | All | Items at or below low-stock threshold |
| GET | `/inventory/:id` | JWT | All | Get single inventory record |
| POST | `/inventory/stock-in` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Add incoming stock |
| PATCH | `/inventory/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Manually adjust quantity |

**Stock In** `POST /inventory/stock-in`
```json
{
  "productId": 10,
  "quantity": 50,
  "notes": "Received from supplier"
}
```

**Adjust Inventory** `PATCH /inventory/:id`
```json
{
  "adjustment": -5,
  "reason": "Damaged goods"
}
```
> `adjustment` can be positive (add) or negative (remove). Cannot go below zero.

**Query Params for** `GET /inventory`

| Param | Type | Description |
|-------|------|-------------|
| `lowStock` | boolean | `true` to show only low-stock items |
| `productId` | number | Filter by product |
| `page` / `limit` | number | Pagination |

**Inventory Object:**
```json
{
  "id": 7,
  "shop_id": 2,
  "product_id": 10,
  "product_name": "Laptop 15\"",
  "current_quantity": 12,
  "low_stock_threshold": 5,
  "is_low_stock": false,
  "updated_at": "2025-01-15T10:00:00Z"
}
```

---

### Orders

Orders are requests from a **Shop** to the **Warehouse** to receive products.

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/orders` | JWT | `SHOP_OWNER`, `WAREHOUSE_ADMIN` | Create a new order |
| GET | `/orders` | JWT | All | List orders |
| GET | `/orders/:id` | JWT | All | Get order details with items |
| PATCH | `/orders/:id/status` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Advance or cancel order status (role restrictions apply) |

**Create Order** `POST /orders`

For `SHOP_OWNER` — `to_shop_id` is set automatically from their account:
```json
{
  "items": [
    { "productId": 10, "quantity": 5 },
    { "productId": 11, "quantity": 3 }
  ]
}
```

For `WAREHOUSE_ADMIN` — must supply `shopId` to set the destination:
```json
{
  "shopId": 2,
  "items": [
    { "productId": 10, "quantity": 5 },
    { "productId": 11, "quantity": 3 }
  ]
}
```

**Update Status** `PATCH /orders/:id/status`
```json
{ "status": "RECEIVED" }
```

**Who can call this and what they can send:**

| Role | Allowed transitions | Ownership check |
|------|---------------------|-----------------|
| `WAREHOUSE_ADMIN` | Any sequential step: `PENDING→PROCESSING→SHIPPED→RECEIVED→COMPLETED` | None — can act on any order |
| `WAREHOUSE_ADMIN` | Cancel: `PENDING→CANCELLED` or `PROCESSING→CANCELLED` | None |
| `SHOP_OWNER` | `SHIPPED→RECEIVED` only | `to_shop_id` must match their shop |
| `SHOP_OWNER` | Cancel: `PENDING→CANCELLED` only | `to_shop_id` must match their shop |

> **Sequential transitions:** You must always send the immediate next status in the chain. Skipping a step (e.g., sending `SHIPPED` while still `PENDING`) returns `400 Bad Request`. The UI should derive the correct next status from the current order status rather than letting the user pick freely.

> **Cancellation:** Once an order is `SHIPPED` or beyond, it cannot be cancelled — returns `400 Bad Request`. `CANCELLED` is a terminal state; no further transitions are allowed from it.

**Order Status Flow:**
```
PENDING → PROCESSING → SHIPPED → RECEIVED → COMPLETED
   ↓            ↓
CANCELLED    CANCELLED
```

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `PENDING` | Shop submitted the order | No |
| `PROCESSING` | Warehouse accepted & is preparing | No |
| `SHIPPED` | Order dispatched | No |
| `RECEIVED` | Shop confirmed delivery | No |
| `COMPLETED` | Order fully closed | Yes |
| `CANCELLED` | Order cancelled before shipping | Yes |

> When status changes to `RECEIVED`, warehouse inventory is automatically decremented and transferred to the shop's inventory inside a single DB transaction. No inventory side effects occur on cancellation.

**Query Params for** `GET /orders`

| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by order status |
| `shop_id` | number | Admin only — filter by destination shop (`to_shop_id`) |
| `page` / `limit` | number | Pagination |

**Order Object (list view):**
```json
{
  "id": 15,
  "from_shop_id": 1,
  "to_shop_id": 2,
  "to_shop_name": "Cairo Branch",
  "status": "PROCESSING",
  "total_items": 8,
  "created_at": "2025-01-10T09:00:00Z",
  "updated_at": "2025-01-10T11:00:00Z",
  "items": [
    { "product_id": 10, "product_name": "Laptop 15\"", "quantity": 5, "price": 1200.00 },
    { "product_id": 11, "product_name": "Monitor", "quantity": 3, "price": 250.00 }
  ]
}
```

**Order Object (detail view — `GET /orders/:id`):**

Same fields as above, plus `total_price`:

```json
{
  "id": 15,
  "from_shop_id": 1,
  "to_shop_id": 2,
  "to_shop_name": "Cairo Branch",
  "status": "PROCESSING",
  "total_items": 8,
  "total_price": 6750.00,
  "created_at": "2025-01-10T09:00:00Z",
  "updated_at": "2025-01-10T11:00:00Z",
  "items": [
    { "product_id": 10, "product_name": "Laptop 15\"", "quantity": 5, "price": 1200.00 },
    { "product_id": 11, "product_name": "Monitor", "quantity": 3, "price": 250.00 }
  ]
}
```

> `total_price` is the sum of `quantity × price` for every item in the order. Prices are **snapshots** captured at order creation time — they do not change if the product price is updated later.

> `from_shop_id` is always the **warehouse** (the supplier); `to_shop_id` / `to_shop_name` identify the **shop** that placed the order.

---

### Notifications

Notifications are auto-generated by the system (e.g., low stock alerts, order status changes).

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/notifications` | JWT | All | List notifications for current user's shop |
| PATCH | `/notifications/read-all` | JWT | All | Mark all as read |
| PATCH | `/notifications/:id/read` | JWT | All | Mark one as read |

**Query Params for** `GET /notifications`

| Param | Type | Description |
|-------|------|-------------|
| `isRead` | boolean | Filter by read status |
| `page` / `limit` | number | Pagination |

**Notification Object:**
```json
{
  "id": 44,
  "shop_id": 2,
  "user_id": 5,
  "title": "Low Stock Alert",
  "message": "Laptop 15\" is running low (3 remaining)",
  "type": "LOW_STOCK",
  "is_read": false,
  "created_at": "2025-01-15T08:00:00Z"
}
```

---

### Audit Logs

Read-only. Tracks all significant actions in the system.

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/audit-logs` | JWT | All | List logs (admin: all shops; others: own shop) |
| GET | `/audit-logs/:id` | JWT | All | Get single log record |

**Query Params for** `GET /audit-logs`

| Param | Type | Description |
|-------|------|-------------|
| `shopId` | number | Admin only |
| `userId` | number | Filter by user |
| `type` | string | Log type |
| `action` | string | Action performed |
| `entityType` | string | e.g., `product`, `order` |
| `entityId` | number | ID of affected entity |
| `fromDate` | ISO date | Start of date range |
| `toDate` | ISO date | End of date range |
| `page` / `limit` | number | Pagination |

**Audit Log Object:**
```json
{
  "id": 100,
  "shop_id": 2,
  "user_id": 5,
  "type": "INVENTORY",
  "action": "STOCK_IN",
  "entity_type": "inventory",
  "entity_id": 7,
  "quantity": 50,
  "amount": null,
  "notes": "Received from supplier",
  "created_at": "2025-01-15T10:00:00Z"
}
```

---

### Analytics

Powers the dashboard charts. Both endpoints aggregate `order_items` across **COMPLETED orders only**. `WAREHOUSE_ADMIN` sees all shops; `SHOP_OWNER` and `EMPLOYEE` are automatically scoped to their own shop.

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/analytics/top-products` | JWT | All | Top N products by total units consumed |
| GET | `/analytics/consumption-trend` | JWT | All | Units consumed over time (daily / weekly / monthly) |

**Top Products** `GET /analytics/top-products`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `5` | How many products to return (max 20) |

```json
[
  { "product_id": 5, "product_name": "Water Bottle 500ml", "total_quantity": 3620 },
  { "product_id": 9, "product_name": "Chocolate Bar 100g", "total_quantity": 750  }
]
```

**Consumption Trend** `GET /analytics/consumption-trend`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `daily` | `daily` (last 14 days) · `weekly` (last 8 weeks) · `monthly` (last 6 months) |

```json
[
  { "label": "2026-06-01", "value": 320 },
  { "label": "2026-06-02", "value": 280 },
  { "label": "2026-06-03", "value": 410 }
]
```

Labels format per period: `daily` → `YYYY-MM-DD`, `weekly` → `YYYY-Www`, `monthly` → `YYYY-MM`. Array is sorted ascending — feed directly to your chart library. Days/weeks/months with zero consumption are omitted (no zero-padding).

---

## 5. Pagination

All list endpoints support pagination via query params, **except `GET /shops`** (which is never large enough to need it and returns all results directly):

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `page` | `1` | — | Page number |
| `limit` | `10` | `100` | Items per page |

**Paginated Response Shape:**
```json
{
  "data": [ /* array of items */ ],
  "total": 150,
  "page": 1,
  "limit": 10,
  "totalPages": 15
}
```

---

## 6. Response Format

All successful responses are wrapped:

```json
{
  "success": true,
  "data": { /* actual payload */ },
  "timestamp": "2025-01-15T10:00:00Z"
}
```

For lists:
```json
{
  "success": true,
  "data": {
    "data": [ /* items */ ],
    "total": 150,
    "page": 1,
    "limit": 10,
    "totalPages": 15
  },
  "timestamp": "2025-01-15T10:00:00Z"
}
```

---

## 7. Error Format

```json
{
  "success": false,
  "statusCode": 400,
  "message": "email must be an email",
  "error": "Bad Request",
  "timestamp": "2025-01-15T10:00:00Z"
}
```

| Status Code | Meaning |
|-------------|---------|
| `400` | Bad request / validation error |
| `401` | Missing or invalid JWT |
| `403` | Authenticated but insufficient role |
| `404` | Resource not found |
| `409` | Conflict (e.g., duplicate email) |
| `429` | Rate limit exceeded |
| `500` | Server error |

---

## 8. Domain Concepts & Enums

### UserRole
```
WAREHOUSE_ADMIN   — full access
SHOP_OWNER        — own shop
EMPLOYEE          — read/limited
```

### ShopType
```
WAREHOUSE    — the central warehouse (only one)
SHOP         — retail branch
```

### OrderStatus
```
PENDING → PROCESSING → SHIPPED → RECEIVED → COMPLETED
   ↓            ↓
CANCELLED    CANCELLED
```

### ProductSource
```
WAREHOUSE    — created by warehouse admin, visible to all shops
LOCAL        — created by a specific shop
```

### Inventory Status (derived from quantity vs threshold)
```
IN_STOCK
LOW_STOCK      — quantity ≤ low_stock_threshold
OUT_OF_STOCK   — quantity = 0
```

---

## 9. UI Flows & Suggested Pages

### Warehouse Admin Views
| Page | Key APIs |
|------|----------|
| Dashboard | `GET /inventory?lowStock=true`, `GET /orders?status=PENDING`, `GET /notifications` |
| Shops Management | `GET /shops`, `POST /users/shop-owners`, `PATCH /shops/:id/status` |
| Warehouse Inventory | `GET /inventory`, `POST /inventory/stock-in`, `PATCH /inventory/:id` |
| Incoming Orders | `GET /orders`, `PATCH /orders/:id/status` |
| Products & Categories | `GET /products`, `GET /categories`, CRUD endpoints |
| Users Management | `GET /users`, `PATCH /users/:id`, `DELETE /users/:id` |
| Audit Logs | `GET /audit-logs` |

### Shop Owner Views
| Page | Key APIs |
|------|----------|
| Dashboard | `GET /inventory?lowStock=true`, `GET /orders`, `GET /notifications` |
| My Inventory | `GET /inventory`, `PATCH /inventory/:id` |
| Place Order | `GET /products?source=WAREHOUSE`, `POST /orders` |
| My Orders | `GET /orders`, `GET /orders/:id` |
| Employees | `GET /users`, `POST /users/employees`, `DELETE /users/:id` |
| My Shop | `GET /shops/:id`, `PATCH /shops/:id` |

### Employee Views
| Page | Key APIs |
|------|----------|
| Inventory | `GET /inventory` |
| Orders | `GET /orders` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read` |

---

## Quick Start Checklist for Frontend

- [ ] Configure Axios/Fetch base URL as `http://localhost:3000`
- [ ] On login success, store **both** `accessToken` and `refreshToken` (localStorage or httpOnly cookies)
- [ ] Add `Authorization: Bearer <accessToken>` header globally on every request
- [ ] Implement a **401 interceptor**: call `POST /auth/refresh` → retry with new token → on second 401, redirect to `/login`
- [ ] After every successful refresh, **replace both stored tokens** (old refresh token is dead)
- [ ] On `POST /auth/logout` success (204), clear both tokens and redirect to `/login`
- [ ] On `403` response → show "Access Denied" UI, do not redirect
- [ ] Use the `role` from the login response (or `/auth/me`) to conditionally render nav items and pages
- [ ] Implement unread notification badge using `GET /notifications?isRead=false`

---

> Questions? The full interactive Swagger docs are at `http://localhost:3000/api` — every endpoint is documented there with request/response schemas.
