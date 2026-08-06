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
   - [Receipts](#receipts)
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
| PATCH | `/users/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Update name/email/password |
| DELETE | `/users/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Soft-deactivate a user |
| PATCH | `/users/:id/activate` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Reactivate a deactivated user |

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

**Update a User** `PATCH /users/:id`
```json
{
  "name": "Ahmed Hassan",
  "email": "ahmed@mdmarket.com",
  "password": "newPassword123"
}
```
> All fields are optional — send only what changes. `password` must be at least 6 characters and is hashed server-side (never returned in responses). `SHOP_OWNER` can only update their own employees; `WAREHOUSE_ADMIN` can update any user (including a shop owner's password/email).

**Reactivate a User** `PATCH /users/:id/activate`

No body required. Sets `is_active` back to `true` for a previously deactivated user. `SHOP_OWNER` can only reactivate employees in their own shop — targeting anyone else returns `403`. Calling it on an already-active user is a no-op (still `200`).

**Response `200`:** the updated `SafeUser` (same shape as above) with `is_active: true`.

> Pair this with the `DELETE /users/:id` button in any user list/detail UI — show "Deactivate" for active users and "Activate" for inactive ones.

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
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
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
| PATCH | `/products/:id/image` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Upload or replace product image |
| DELETE | `/products/:id/image` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Remove product image → `204 No Content` |
| DELETE | `/products/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Soft-delete product → `204 No Content` |

**Create Product** `POST /products`
```json
{
  "name": "Laptop 15\"",
  "description": "Core i7 laptop",
  "barcode": "1234567890",
  "price": 1200.00,
  "cost_price": 850.00,
  "category_id": 3
}
```

> `price` — **selling price** (what the product is sold for). Required, must be > 0.  
> `cost_price` — **buying price** (what it cost to acquire). Optional, must be ≥ 0, defaults to `0`. Used for profit analytics (see [Analytics](#analytics)). Also updatable via `PATCH /products/:id`.

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

**Upload Product Image** `PATCH /products/:id/image`

Send as `multipart/form-data` with field name `image`. Max size: 5 MB. Accepted formats: `jpeg`, `png`, `webp`, `gif`.

**Response `200`:**
```json
{ "image_url": "/uploads/products/uuid.jpg" }
```

> Prepend the base URL to get the full image URL: `http://localhost:3000/uploads/products/uuid.jpg`

**Delete Product Image** `DELETE /products/:id/image`

No body required. Sets `image_url` back to `null`.

**Response:** `204 No Content`

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
  "cost_price": "850.00",
  "source": "WAREHOUSE",
  "is_global": true,
  "is_orderable": true,
  "image_url": "/uploads/products/uuid.jpg",
  "is_active": true,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z",
  "in_inventory": false,
  "current_quantity": 0
}
```

> **Browse Products / catalog cards:** for shop (non-admin) callers, each list
> item includes `in_inventory` (does this shop already track it?) and
> `current_quantity` (this shop's stock). Build the catalog from
> `GET /products?source=WAREHOUSE`, group by `category_name`, render each card as
> **Add** or **Added ✓** based on `in_inventory`, and call `POST /inventory` on
> tap. The product then appears on the inventory page as out-of-stock.
>
> **Restocking depends on `is_orderable`.** `true` (the default) means the
> warehouse actually carries the product and it can be restocked via
> `POST /orders`. `false` means it's a **catalog-only listing** — a name/category
> template with no real warehouse stock (e.g. the seeded warehouse catalog) —
> and ordering it will fail with `orders.PRODUCT_NOT_ORDERABLE`. Use
> `GET /products?is_orderable=true` for the **order-item picker** specifically
> (a different, narrower list than the full Browse Products catalog above, which
> should still show catalog-only items as addable but not orderable).

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
  "cost_price": "850.00",
  "source": "WAREHOUSE",
  "is_global": true,
  "image_url": "/uploads/products/uuid.jpg",
  "is_active": true,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z",
  "current_quantity": 42
}
```

> `source: "WAREHOUSE"` — product defined at the warehouse level.  
> `source: "LOCAL"` — product defined by a shop.  
> `current_quantity` — returns `0` if no inventory record exists yet for this product.  
> `image_url` — `null` until an image is uploaded.  
> `cost_price` — **visibility rule:** `WAREHOUSE_ADMIN` always sees it; `SHOP_OWNER` / `EMPLOYEE` see it only on their own shop's products. On warehouse products it comes back as `null` for shop users (the warehouse's margin is not exposed). Render the field only when it is non-null.

---

### Categories

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/categories` | JWT | All | List categories |
| GET | `/categories/:id` | JWT | All | Get single category |
| POST | `/categories` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Create category |
| PATCH | `/categories/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Rename category |
| PATCH | `/categories/:id/image` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Upload or replace category image |
| DELETE | `/categories/:id/image` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Remove category image → `204 No Content` |
| DELETE | `/categories/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Delete (fails if products exist) → `204 No Content` |

**Query Params for** `GET /categories`

| Param | Type | Description |
|-------|------|-------------|
| `shopId` | number | Admin only — filter by specific shop |

**Create/Update Category:**
```json
{ "name": "Electronics" }
```

**Upload Category Image** `PATCH /categories/:id/image`

Send as `multipart/form-data` with field name `image`. Max size: 5 MB. Accepted formats: `jpeg`, `png`, `webp`, `gif`.

**Response `200`:**
```json
{ "image_url": "/uploads/categories/uuid.jpg" }
```

> Prepend the base URL to get the full image URL: `http://localhost:3000/uploads/categories/uuid.jpg`

**Delete Category Image** `DELETE /categories/:id/image`

No body required. Sets `image_url` back to `null`.

**Response:** `204 No Content`

**Category Object:**
```json
{
  "id": 3,
  "shop_id": 1,
  "name": "Electronics",
  "image_url": "/uploads/categories/uuid.jpg",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
}
```

> Non-admin users see: their own shop's categories **+** warehouse categories.  
> `image_url` — `null` until an image is uploaded.

---

### Inventory

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/inventory` | JWT | All | List inventory items |
| GET | `/inventory/low-stock` | JWT | All | Items at or below low-stock threshold |
| GET | `/inventory/:id` | JWT | All | Get single inventory record |
| POST | `/inventory/stock-in` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Add incoming stock |
| POST | `/inventory` | JWT | `SHOP_OWNER`, `EMPLOYEE` | Add a catalog product to inventory at qty 0 (idempotent) |
| PATCH | `/inventory/:id` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Manually adjust quantity |

**Stock In** `POST /inventory/stock-in`
```json
{
  "productId": 10,
  "quantity": 50,
  "notes": "Received from supplier"
}
```

**Add product from catalog** `POST /inventory`
```json
{
  "productId": 4,
  "quantity": 0
}
```
> The "Browse Products" catalog action. Registers the product on this shop's
> inventory **without moving stock** (defaults to qty 0); it then shows as
> out-of-stock and is restocked via the orders flow. `quantity` is an optional
> opening balance. Idempotent — re-adding returns the existing record.
> `productId` must be the shop's own product or a `WAREHOUSE` one, else `403`.

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

> **`400 orders.PRODUCT_NOT_ORDERABLE`** if any `productId` has `is_orderable: false`
> (a catalog-only listing). Build the order-item picker from
> `GET /products?is_orderable=true` so this can't happen from normal use.

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

> **Inventory side-effects:**
> - **Order creation (`PENDING`)** — warehouse stock is validated and deducted immediately. If any product is out of stock or has insufficient quantity, the request is rejected with `400 Bad Request` before the order is created.
> - **`RECEIVED`** — the reserved stock is transferred into the shop's inventory (no further warehouse deduction).
> - **`CANCELLED`** — the previously deducted warehouse stock is restored. Cancellation is only possible from `PENDING` or `PROCESSING`.
>
> This means `GET /inventory` for the warehouse will reflect reduced stock as soon as an order is placed, not only when it is received.

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

Notifications are auto-generated by the system (e.g., low stock alerts, order status changes). **`title` and `message` are translated at read time** based on the `Accept-Language` header — send `Accept-Language: ar` to get Arabic text.

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
  "user_id": null,
  "title": "Low Stock: Laptop 15\"",
  "message": "Product \"Laptop 15\"\" is below the minimum stock level.",
  "type": "LOW_STOCK",
  "args": { "productName": "Laptop 15\"" },
  "is_read": false,
  "created_at": "2025-01-15T08:00:00Z"
}
```

> `title` and `message` are already translated into the requested language — do not translate them on the client.  
> `args` contains the raw dynamic values used for interpolation (e.g. order ID, product name). You can use these for custom rendering if needed, but the translated `title`/`message` strings are ready to display as-is.  
> `args` is `null` for notifications created before the i18n upgrade — their `title`/`message` are stored as plain English strings and are returned as-is regardless of language.

**Notification types and their translated text:**

| `type` | Language | `title` | `message` |
|--------|----------|---------|-----------|
| `ORDER_CREATED` | `en` | `New Order #28` | `Order #28 has been submitted and is waiting for review.` |
| `ORDER_CREATED` | `ar` | `طلب جديد #28` | `تم تقديم الطلب #28 وهو في انتظار المراجعة.` |
| `ORDER_STATUS` | `en` | `Order #28 Updated` | `Order #28 is now SHIPPED.` |
| `ORDER_STATUS` | `ar` | `تحديث الطلب #28` | `الطلب #28 أصبح الآن SHIPPED.` |
| `LOW_STOCK` | `en` | `Low Stock: Laptop 15"` | `Product "Laptop 15"" is below the minimum stock level.` |
| `LOW_STOCK` | `ar` | `مخزون منخفض: Laptop 15"` | `المنتج "Laptop 15"" أقل من الحد الأدنى للمخزون.` |

> Dynamic values (order ID, product name) are injected automatically — the examples above use real values.  
> `?lang=ar` now works here too. It used to 400 with `property lang should not exist` on every endpoint that takes query params; that is fixed. The `Accept-Language` header still works and is still the recommended default — use `?lang=` only for one-off overrides (a language switcher previewing the other locale, a shareable link).

---

### Audit Logs

Read-only. Tracks all significant actions in the system.

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/audit-logs` | JWT | All | List logs (admin: all shops; others: own shop) |
| GET | `/audit-logs/:id` | JWT | All | Get single log record with full details |

**Query Params for** `GET /audit-logs`

| Param | Type | Description |
|-------|------|-------------|
| `shopId` | number | Admin only |
| `userId` | number | Filter by user |
| `type` | string | Log type |
| `action` | string | Action performed |
| `entityType` | string | e.g., `inventory`, `order` |
| `entityId` | number | ID of affected entity |
| `receiptId` | number | Filter to logs generated by a specific receipt (creation + free-toggle entries) |
| `fromDate` | ISO date | Start of date range |
| `toDate` | ISO date | End of date range |
| `page` / `limit` | number | Pagination |

**Audit Log Object (list — `GET /audit-logs`):**
```json
{
  "id": 100,
  "shop_id": 2,
  "shop_name": "Cairo Branch",
  "user_id": 5,
  "user_name": "Sara Ali",
  "type": "INVENTORY",
  "action": "STOCK_IN",
  "entity_type": "inventory",
  "entity_id": 7,
  "receipt_id": null,
  "quantity": 50,
  "amount": null,
  "notes": "Received from supplier",
  "created_at": "2025-01-15T10:00:00Z",
  "type_label": "Inventory",
  "action_label": "Stock In",
  "entity_type_label": "Inventory Item"
}
```

> **Localization.** `type_label`, `action_label` and `entity_type_label` are the display text for `type`, `action` and `entity_type` in the requested language — render these, do not keep a client-side code→label map. The raw codes stay on the response and are still what you filter, sort, colour and pick icons by. An unrecognised code falls back to the code itself, so the field is never null when the code isn't.
>
> `notes` is translated **only** when the entry was written by the system. See the table below for which rows those are. Anything a user typed is returned exactly as they typed it, in whatever language they used, and entries written before this feature shipped stay English in both locales. So one page of logs can legitimately mix English and Arabic — render `notes` with `dir="auto"` and do not assume it matches the active locale.

> `shop_name` and `user_name` are always resolved from their IDs — no need to look them up separately.  
> `shop_name` is `null` for `ORDER / STATUS_CHANGED` logs (those are not scoped to a single shop).  
> `receipt_id` is non-null only for logs generated by a receipt (creation, `MARKED_FREE`, `UNMARKED_FREE`) — `null` for everything else (manual stock-in/adjustment, order transfers). Use it to group/filter all log entries belonging to one receipt (see `receiptId` query param above), instead of parsing an id out of `notes`.

**Audit Log Object (detail — `GET /audit-logs/:id`):**

Same fields as the list object, plus `product_name`:

```json
{
  "id": 100,
  "shop_id": 2,
  "shop_name": "Cairo Branch",
  "user_id": 5,
  "user_name": "Sara Ali",
  "type": "INVENTORY",
  "action": "STOCK_IN",
  "entity_type": "inventory",
  "entity_id": 7,
  "receipt_id": null,
  "quantity": 50,
  "amount": null,
  "notes": "Received from supplier",
  "created_at": "2025-01-15T10:00:00Z",
  "product_name": "Laptop 15\"",
  "type_label": "Inventory",
  "action_label": "Stock In",
  "entity_type_label": "Inventory Item"
}
```

> `product_name` is populated for all `INVENTORY` actions and `null` for `ORDER / STATUS_CHANGED` logs.

**Action types and how to read them:**

| `type` | `action` | `entity_type` | `entity_id` points to | `receipt_id` | What `quantity` means | What `notes` contains |
|--------|----------|--------------|----------------------|--------------|-----------------------|-----------------------|
| `INVENTORY` | `STOCK_IN` | `inventory` | inventory row | `null` | Units added | Optional supplier note |
| `INVENTORY` | `ADJUSTMENT` | `inventory` | inventory row | set when the adjustment came from a receipt; `null` for manual `PATCH /inventory/:id` adjustments | Adjustment amount (negative = removal) | Manual adjustments: reason given. Receipt-driven: that receipt's own `notes` (or `null` if it had none) |
| `INVENTORY` | `PRICE_CHANGE` | `inventory` | inventory row | `null` | `null` (`amount` holds the new price) | 🌐 `"Selling price: 10.00 → 13.75"` |
| `INVENTORY` | `TRANSFER_OUT` | `inventory` | warehouse inventory row | `null` | Units deducted | 🌐 `"Order #15 — reserved for shop 2"` |
| `INVENTORY` | `TRANSFER_IN` | `inventory` | shop inventory row | `null` | Units received (or restored) | 🌐 `"Order #15 — received from warehouse"` or `"Order #15 — cancelled, stock returned to warehouse"` |
| `INVENTORY` | `MARKED_FREE` | `inventory` | inventory row | the receipt being toggled | `null` — no stock actually moves | That receipt's own `notes` (or `null` if it had none) |
| `INVENTORY` | `UNMARKED_FREE` | `inventory` | inventory row | the receipt being toggled | `null` — no stock actually moves | That receipt's own `notes` (or `null` if it had none) |
| `ORDER` | `STATUS_CHANGED` | `order` | order row | `null` | `null` | 🌐 `"Pending → Processing"` |
| `DEBT` | `PAYMENT` | `debt` | debt row | set for a receipt-backed (customer) debt; `null` for order and supplier debts | `null` (`amount` holds the payment) | Whatever note the collector typed, or `null`. Supplier payables only: 🌐 wrapped as `"<note> (invoice INV-777)"` |
| `DEBT` | `REVERSAL` | `debt` | debt row | as above | `null` (`amount` is negative) | Same as `PAYMENT` |
| `DEBT` | `CANCELLED` | `debt` | debt row | as above | `null` | 🌐 `"Order #15 cancelled"` / `"Receipt #42 cancelled"` when the system voided it; the user's reason when they gave one |

> 🌐 = the backend translates this string. Everything else in the `notes` column is user-entered and comes back verbatim.

> **`MARKED_FREE` / `UNMARKED_FREE`:** one log entry is written per item in the receipt (same pattern as receipt creation's `ADJUSTMENT` entries) — a 3-item receipt marked free produces 3 log rows, not 1. `amount` holds that item's line revenue (`quantity × price`) rather than `null`. `quantity` is always `null` since no stock actually moves — the deduction already happened when the receipt was created; marking it free only changes how it's counted in profit reports.
>
> **Getting "which receipt" for a log row:** use the `receipt_id` field directly (or the `receiptId` query param to fetch a receipt's whole log trail) — do **not** parse `notes`, which now only carries the receipt's own free-text note and no longer contains a `"Receipt #<id>"` reference.
>
> **Never pattern-match `notes` at all.** The same row now reads `"Order #15 — received from warehouse"` or `"الطلب رقم 15 — تم الاستلام من المستودع"` depending on the request, so any regex like `/Order #(\d+)/` breaks the moment a user switches to Arabic. Every id you might want is already a structured field: `entity_id`, `receipt_id`, `quantity`, `amount`.

---

### Analytics

Powers the dashboard charts. Order-based endpoints aggregate `order_items` across **COMPLETED orders only**, filtered by `updated_at` (when the order reached COMPLETED status); receipt-based endpoints (`shop-consumption`, and the profit endpoints when scoped to a shop) aggregate `receipt_items` by `created_at`. `WAREHOUSE_ADMIN` sees all shops; `SHOP_OWNER` and `EMPLOYEE` are automatically scoped to their own shop.

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/analytics/top-products` | JWT | All | Top N products by total units consumed |
| GET | `/analytics/consumption-trend` | JWT | All | Units consumed over time (daily / weekly / monthly) |
| GET | `/analytics/products-by-shop` | JWT | `WAREHOUSE_ADMIN` | Top N products with per-shop consumption breakdown |
| GET | `/analytics/shop-consumption` | JWT | All | Per-product consumption for a shop, sourced from receipts |
| GET | `/analytics/profit-summary` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Revenue, cost and profit totals for the period |
| GET | `/analytics/profit-trend` | JWT | `WAREHOUSE_ADMIN`, `SHOP_OWNER` | Revenue / cost / profit per time bucket |

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

**Shop Consumption** `GET /analytics/shop-consumption`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `daily` | `daily` (last 14 days) · `weekly` (last 8 weeks) · `monthly` (last 6 months) |
| `shopId` | number | — | **Required for `WAREHOUSE_ADMIN`** — which shop to inspect. Ignored for `SHOP_OWNER` / `EMPLOYEE` (auto-scoped to their own shop from the JWT) |
| `page` | number | `1` | Page number |
| `limit` | number | `10` | Products per page — use this to control how many bars the chart renders at once |

**Response:**
```json
{
  "data": [
    { "product_id": 3, "product_name": "gl-t-shirt",   "quantity": 631 },
    { "product_id": 4, "product_name": "Monitor Stand", "quantity": 22  },
    { "product_id": 2, "product_name": "Water",         "quantity": 14  }
  ],
  "page": 1,
  "limit": 10,
  "total": 8,
  "totalPages": 1,
  "hasNext": false,
  "hasPrev": false
}
```

> Sorted by `quantity` descending — most consumed product first. The sort order is consistent across pages.  
> Products with zero consumption in the selected period are excluded entirely.  
> If `shopId` does not exist, the response returns an empty `data` array (not a `404`).  
> **Data source:** `receipt_items` — counts actual inventory decreases created by shop staff, not warehouse orders. This reflects what the shop *used*, not what it *received*.  
> **Chart usage:** set `limit` to however many bars fit on screen (e.g. `10`), then use `hasNext` / `hasPrev` to render prev/next navigation buttons. `total` and `totalPages` let you show "Page 1 of 3 (8 products)" labels.

**Error (`400`)** — returned only when `WAREHOUSE_ADMIN` omits `shopId`:
```json
{ "message": "shopId is required for WAREHOUSE_ADMIN" }
```

---

**Products by Shop** `GET /analytics/products-by-shop`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `daily` | `daily` (last 14 days) · `weekly` (last 8 weeks) · `monthly` (last 6 months) |
| `limit` | number | `10` | Max products to return, sorted by total consumption descending (max 50) |
| `shopId` | number | — | Filter to a single shop. Omit to see all shops grouped together |

**Response — no `shopId` (all shops grouped):**
```json
[
  {
    "product_id": 5,
    "product_name": "Water Bottle 500ml",
    "total_quantity": 3620,
    "shops": [
      { "shop_id": 2, "shop_name": "Cairo Branch", "quantity": 2100 },
      { "shop_id": 3, "shop_name": "Alex Branch",  "quantity": 1220 },
      { "shop_id": 4, "shop_name": "Giza Branch",  "quantity": 300  }
    ]
  },
  {
    "product_id": 9,
    "product_name": "Chocolate Bar 100g",
    "total_quantity": 750,
    "shops": [
      { "shop_id": 2, "shop_name": "Cairo Branch", "quantity": 750 }
    ]
  }
]
```

**Response — with `shopId` (single shop):**

Same structure, but `total_quantity` reflects only that shop's consumption and `shops` contains only the one requested shop:
```json
[
  {
    "product_id": 5,
    "product_name": "Water Bottle 500ml",
    "total_quantity": 2100,
    "shops": [
      { "shop_id": 2, "shop_name": "Cairo Branch", "quantity": 2100 }
    ]
  }
]
```

**Field definitions:**

| Field | Description |
|-------|-------------|
| `product_id` | Product ID |
| `product_name` | Product name |
| `total_quantity` | Sum of quantities across all included shops within the period |
| `shops` | Shops that consumed this product — only shops with `quantity > 0` |
| `shops[].shop_id` | Shop ID |
| `shops[].shop_name` | Shop name |
| `shops[].quantity` | Units consumed by this shop within the period |

> Products are sorted by `total_quantity` descending (highest first). Within each product, `shops` is sorted by `quantity` descending.  
> Products with zero consumption in the selected period are excluded entirely.  
> If `shopId` does not exist, the response is an empty array (not a `404`).  
> The response is not paginated — it is capped by `limit`.

---

**Profit Summary** `GET /analytics/profit-summary`

Profit is computed from **price snapshots taken at transaction time** (`price` and `cost_price` stored on each order/receipt item), so changing a product's prices later never rewrites historical profit.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `daily` | `daily` (last 14 days) · `weekly` (last 8 weeks) · `monthly` (last 6 months) |
| `shopId` | number | — | `WAREHOUSE_ADMIN` only — view a specific shop's **sales** profit instead of warehouse profit. Ignored for `SHOP_OWNER` (auto-scoped to their own shop from the JWT) |

**Scoping — who sees which profit:**

| Caller | Data source | Meaning |
|--------|-------------|---------|
| `WAREHOUSE_ADMIN` (no `shopId`) | `order_items` of **COMPLETED orders** | Warehouse profit: what shops paid minus warehouse cost |
| `WAREHOUSE_ADMIN` + `?shopId=` | `receipt_items` of that shop | That shop's sales profit: customer sales minus cost |
| `SHOP_OWNER` | `receipt_items` of own shop | Own shop's sales profit |
| `EMPLOYEE` | — | `403` — profit data is owner-level information |

**Response:**
```json
{
  "revenue": 20352.27,
  "cost": 13143.75,
  "profit": 7208.52
}
```

| Field | Description |
|-------|-------------|
| `revenue` | Σ `quantity × price` (selling price snapshot) |
| `cost` | Σ `quantity × cost_price` (buying price snapshot) |
| `profit` | `revenue − cost` |

> All three are plain numbers (float), ready for display — no string parsing needed.  
> Transactions recorded **before the cost-price feature existed** have `cost_price = 0`, so their profit equals full revenue. Expect inflated profit on old data until new transactions accumulate.  
> An empty period returns zeros (`{ "revenue": 0, "cost": 0, "profit": 0 }`), never a `404`.  
> **Free receipts** (`is_free: true`, see [Receipts](#receipts)) are excluded from `revenue` but still counted in `cost` — the shop still gave out the inventory, it just wasn't paid for. So a free receipt's net effect on `profit` is `-total_price` of that receipt.

**Profit Trend** `GET /analytics/profit-trend`

Same params, scoping and field meanings as `profit-summary`, but bucketed over time for charts:

```json
[
  { "label": "2026-W21", "revenue": 1296.60, "cost": 835.00,  "profit": 461.60  },
  { "label": "2026-W25", "revenue": 2466.60, "cost": 1575.50, "profit": 891.10  },
  { "label": "2026-W26", "revenue": 6536.87, "cost": 4277.75, "profit": 2259.12 }
]
```

> Label formats and sorting match `consumption-trend`: `daily` → `YYYY-MM-DD`, `weekly` → `YYYY-Www`, `monthly` → `YYYY-MM`, ascending, zero buckets omitted (no zero-padding).  
> **Chart usage:** render `revenue` and `profit` as two series (line or grouped bar); `cost` is derivable as the gap between them.

---

### Receipts

A Receipt records a batch consumption event — one or more inventory items decreased together in a single atomic operation. Receipts are immutable after creation.

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/receipts` | JWT | All | Create a receipt — batch-decreases inventory atomically |
| GET | `/receipts` | JWT | All | List receipts (admin: all shops; others: own shop only) |
| GET | `/receipts/:id` | JWT | All | Get receipt detail with all items |
| PATCH | `/receipts/:id/free` | JWT | All | Mark/unmark a receipt as free — excludes its revenue from shop profit reports |

**Create Receipt** `POST /receipts`
```json
{
  "items": [
    { "inventoryId": 7, "quantity": 5 },
    { "inventoryId": 8, "quantity": 3 }
  ],
  "notes": "End of day stock count"
}
```

- `inventoryId` — the inventory row ID (same ID from `GET /inventory`)
- `quantity` — always a positive number (units consumed)
- `notes` — optional free-text reason for the batch decrease
- `shop_id` is taken from the authenticated user's account — not sent by the client
- All items are applied atomically — if any would bring a quantity below zero the entire request is rejected with `400`

**Response `201`:**
```json
{
  "id": 1,
  "shop_id": 2,
  "created_by": 5,
  "notes": "End of day stock count",
  "is_free": false,
  "created_at": "2026-06-27T10:00:00Z",
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

> `price` is a snapshot captured at receipt creation time — it does not change if the product price is updated later.  
> `total_price` is the sum of `quantity × price` for every item in the receipt.

**Receipt creation errors (`400`):**

| Scenario | `message` |
|----------|-----------|
| Not enough stock | `receipt.NEGATIVE_STOCK` |
| Same `inventoryId` appears twice in `items` | `receipt.DUPLICATE_INVENTORY_IDS` |

**Mark/Unmark Receipt Free** `PATCH /receipts/:id/free`

Use this to power a "Make Free" / "Undo Free" button on a receipt's detail or list row. Any role that can create receipts can also toggle this flag (Warehouse Admin, Shop Owner, Employee — same as `POST /receipts`).

```json
{ "isFree": true }
```

**Response `200`:** the full Receipt Detail object (same shape as `POST /receipts`, `is_free` reflects the new value):
```json
{
  "id": 1,
  "shop_id": 2,
  "created_by": 5,
  "notes": "End of day stock count",
  "is_free": true,
  "created_at": "2026-06-27T10:00:00Z",
  "total_price": 37.00,
  "items": [ /* ... */ ]
}
```

> **What "free" means for profit reporting:** marking a receipt free does **not** undo the inventory deduction — the items were still physically given out, so their cost still counts. What changes is that the receipt's `total_price` (revenue) is excluded from `GET /analytics/profit-summary` and `/analytics/profit-trend`. Net effect: the shop's total profit for the period drops by exactly the receipt's `total_price`, since the cost was incurred with no revenue to offset it. See the updated [Profit Summary](#analytics) notes below.
>
> Send `{ "isFree": false }` to undo it — the receipt's revenue counts again on the next profit fetch.
>
> `404` if the receipt doesn't exist; `403` if it belongs to a different shop (same access rule as `GET /receipts/:id`).

**Query Params for** `GET /receipts`

| Param | Type | Description |
|-------|------|-------------|
| `shopId` | number | Admin only — filter by shop |
| `createdBy` | number | Filter by user ID |
| `fromDate` | ISO date | Start of date range (inclusive) |
| `toDate` | ISO date | End of date range (inclusive) |
| `page` / `limit` | number | Pagination |

**Receipt List Object (`GET /receipts`):**
```json
{
  "id": 1,
  "shop_id": 2,
  "shop_name": "Cairo Branch",
  "created_by": 5,
  "created_by_name": "Sara Ali",
  "total_items": 2,
  "notes": "End of day stock count",
  "is_free": false,
  "created_at": "2026-06-27T10:00:00Z"
}
```

**Receipt Detail Object (`GET /receipts/:id`):**

Same shape as the `POST` response above — includes the full `items` array with `price` per item, `quantity_before`/`quantity_after` snapshots, and `total_price`.

> Each receipt creation also writes one `INVENTORY / ADJUSTMENT` audit log entry per item, with `receipt_id` set to this receipt's id and `notes` carrying this receipt's own `notes` (or `null`), so the audit log trail stays consistent with single-item adjustments and can be filtered via `GET /audit-logs?receiptId=<id>`.

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
  "page": 1,
  "limit": 10,
  "total": 150,
  "totalPages": 15,
  "hasNext": true,
  "hasPrev": false
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
    "page": 1,
    "limit": 10,
    "total": 150,
    "totalPages": 15,
    "hasNext": true,
    "hasPrev": false
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

`message` is always a **plain string**. If multiple validation errors occur on the same request they are joined with `'; '` (e.g. `"productId must be an integer; quantity must be a positive number"`).

**Order creation stock errors (`400`):**

| Scenario | `message` example |
|----------|-------------------|
| Product has zero stock | `Product "Milk 1L" is out of stock and cannot be ordered` |
| Product has some stock but not enough | `Insufficient stock for product "Milk 1L" (available: 2, required: 5)` |
| Product not in warehouse inventory | `Product 42 does not exist in warehouse inventory` |

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
| Dashboard | `GET /inventory?lowStock=true`, `GET /orders?status=PENDING`, `GET /notifications`, `GET /analytics/products-by-shop` |
| Profit Dashboard | `GET /analytics/profit-summary`, `GET /analytics/profit-trend` (warehouse-wide, or per shop with `?shopId=`) |
| Shops Management | `GET /shops`, `POST /users/shop-owners`, `PATCH /shops/:id/status` |
| Warehouse Inventory | `GET /inventory`, `POST /inventory/stock-in`, `PATCH /inventory/:id` |
| Incoming Orders | `GET /orders`, `PATCH /orders/:id/status` |
| Products & Categories | `GET /products`, `GET /categories`, CRUD endpoints |
| Users Management | `GET /users`, `PATCH /users/:id`, `DELETE /users/:id`, `PATCH /users/:id/activate` |
| Audit Logs | `GET /audit-logs` |

### Shop Owner Views
| Page | Key APIs |
|------|----------|
| Dashboard | `GET /inventory?lowStock=true`, `GET /orders`, `GET /notifications`, `GET /analytics/shop-consumption` |
| Profit Dashboard | `GET /analytics/profit-summary`, `GET /analytics/profit-trend` (auto-scoped to own shop; not available to employees) |
| My Inventory | `GET /inventory`, `PATCH /inventory/:id` |
| Receipts | `GET /receipts`, `POST /receipts`, `GET /receipts/:id`, `PATCH /receipts/:id/free` |
| Place Order | `GET /products?source=WAREHOUSE`, `POST /orders` |
| My Orders | `GET /orders`, `GET /orders/:id` |
| Employees | `GET /users`, `POST /users/employees`, `DELETE /users/:id`, `PATCH /users/:id/activate` |
| My Shop | `GET /shops/:id`, `PATCH /shops/:id` |

### Employee Views
| Page | Key APIs |
|------|----------|
| Inventory | `GET /inventory` |
| Receipts | `GET /receipts`, `POST /receipts`, `GET /receipts/:id`, `PATCH /receipts/:id/free` |
| Orders | `GET /orders` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read` |
| Consumption Chart | `GET /analytics/shop-consumption` |

---

## Quick Start Checklist for Frontend

- [ ] Configure Axios/Fetch base URL as `http://localhost:3000`
- [ ] On login success, store **both** `accessToken` and `refreshToken` (localStorage or httpOnly cookies)
- [ ] Add `Authorization: Bearer <accessToken>` header globally on every request
- [ ] Add `Accept-Language: ar` (or `en`) header globally — error messages, notification text and audit-log text all arrive pre-translated
- [ ] Implement a **401 interceptor**: call `POST /auth/refresh` → retry with new token → on second 401, redirect to `/login`
- [ ] After every successful refresh, **replace both stored tokens** (old refresh token is dead)
- [ ] On `POST /auth/logout` success (204), clear both tokens and redirect to `/login`
- [ ] On `403` response → show "Access Denied" UI, do not redirect
- [ ] Use the `role` from the login response (or `/auth/me`) to conditionally render nav items and pages
- [ ] Implement unread notification badge using `GET /notifications?isRead=false`
- [ ] Display notification `title` and `message` directly — they arrive translated, no client-side mapping needed
- [ ] Audit log rows: render `type_label` / `action_label` / `entity_type_label`, and delete any client-side code→label map. Keep the raw `type` / `action` / `entity_type` for filters, badge colours and icons
- [ ] Render audit `notes` with `dir="auto"` and handle `null` — history predating the i18n change stays English, and user-typed notes are in whatever language they were written

---

> Questions? The full interactive Swagger docs are at `http://localhost:3000/api` — every endpoint is documented there with request/response schemas.
