# Project Status — Inventory Distribution System BE

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24, NestJS 10, TypeScript 5 |
| Database | PostgreSQL 16 — raw SQL via `pg` (no ORM) |
| Auth | Passport + JWT (`@nestjs/jwt`, `passport-jwt`, `bcrypt`) |
| Validation | `class-validator` + `class-transformer` |
| Docs | `@nestjs/swagger` — wired, Swagger UI at `/api` |
| Infra | Docker Compose — postgres + app + pgadmin |

---

## Business Model

Central Warehouse distribution system.

```
WAREHOUSE_ADMIN (Milad)
│
├── MD Market        ← SHOP_OWNER + EMPLOYEEs
├── ABC Store        ← SHOP_OWNER + EMPLOYEEs
└── Super Shop       ← SHOP_OWNER + EMPLOYEEs
```

No public registration. All accounts provisioned by privileged roles.

---

## Database Schema

11 migrations in `src/database/migrations/`, run in filename order.

| Table | Key Columns | Notes |
|---|---|---|
| `shops` | `id`, `name`, `address`, `phone`, `type`, `is_active` | `type`: `WAREHOUSE` or `SHOP` |
| `users` | `id`, `shop_id`, `name`, `email`, `password_hash`, `role` | `WAREHOUSE_ADMIN` linked to warehouse shop |
| `categories` | `id`, `shop_id`, `name`, `updated_at` | Per-shop; warehouse categories are global |
| `products` | `id`, `category_id`, `shop_id`, `name`, `barcode`, `price`, `source`, `is_active` | `source` auto-set from shop type |
| `inventory` | `id`, `shop_id`, `product_id`, `current_quantity`, `low_stock_threshold` | Unique on `(shop_id, product_id)`; threshold default 10 |
| `orders` | `id`, `from_shop_id`, `to_shop_id`, `status`, `total_items` | Supports warehouse ↔ shop direction |
| `order_items` | `id`, `order_id`, `product_id`, `quantity`, `price` | |
| `notifications` | `id`, `shop_id`, `user_id`, `title`, `type`, `is_read` | |
| `audit_logs` | `id`, `shop_id`, `user_id`, `type`, `action`, `entity_type`, `entity_id`, `quantity`, `amount`, `notes` | Append-only history of all mutations |

**User roles:** `WAREHOUSE_ADMIN` · `SHOP_OWNER` · `EMPLOYEE`

**Seeded accounts:**
- `admin@warehouse.com` / `Admin@123` → `WAREHOUSE_ADMIN`

---

## Module Status

| Module | Module | Service | Controller | DTOs | Real Logic |
|---|---|---|---|---|---|
| app | ✅ | ✅ health | ✅ `/`, `/health` | — | ✅ |
| auth | ✅ | ✅ login | ✅ `/auth/login`, `/auth/me` | ✅ `LoginDto` | ✅ |
| users | ✅ | ✅ provisioning | ✅ `/users/shop-owners`, `/users/employees` | ✅ | ✅ |
| shops | ✅ | ✅ CRUD + status | ✅ `GET /shops`, `GET /shops/:id`, `PATCH /shops/:id`, `PATCH /shops/:id/status` | ✅ `UpdateShopDto`, `UpdateShopStatusDto` | ✅ |
| products | ✅ | ✅ CRUD + soft delete | ✅ `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id` | ✅ `CreateProductDto`, `UpdateProductDto`, `ProductQueryDto` | ✅ |
| categories | ✅ | ✅ CRUD + global | ✅ `GET /categories`, `GET /categories/:id`, `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` | ✅ `CreateCategoryDto`, `UpdateCategoryDto` | ✅ |
| inventory | ✅ | ✅ stock-in, adjust, low-stock | ✅ `GET /inventory`, `GET /inventory/low-stock`, `GET /inventory/:id`, `POST /inventory/stock-in`, `PATCH /inventory/:id` | ✅ `StockInDto`, `AdjustInventoryDto`, `InventoryQueryDto` | ✅ |
| audit-logs | ✅ | ✅ log(), findAll, findById | ✅ `GET /audit-logs`, `GET /audit-logs/:id` | ✅ `AuditLogQueryDto` | ✅ |
| orders | ✅ | ✅ createOrder, findAll, findById, updateStatus | ✅ `POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status` | ✅ `CreateOrderDto`, `UpdateOrderStatusDto`, `OrderQueryDto` | ✅ |
| warehouse | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
| notifications | ✅ | ✅ findAll, markRead, markAllRead, notifyOrderCreated, notifyStatusChanged, notifyLowStock | ✅ `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` | ✅ `NotificationQueryDto` | ✅ |

---

## Infrastructure

### Done
- ✅ Migration runner — transactional, ordered by filename, tracked in `migrations` table
- ✅ `DatabaseService` — pg client wrapper
- ✅ `DatabaseModule` — `@Global()` module, injectable everywhere without re-importing
- ✅ `TransformInterceptor` — wraps all responses as `{ success, data, timestamp }`
- ✅ `HttpExceptionFilter` — standardised error shape `{ success: false, statusCode, message }`
- ✅ `PaginationDto` + `paginationUtil`
- ✅ `JwtStrategy` — reads bearer token, returns `{ id, email, role, shopId }`
- ✅ `JwtAuthGuard` — blocks unauthenticated access
- ✅ `RolesGuard` — enforces `@Roles()` decorator, returns 403 on mismatch
- ✅ `@CurrentUser()` decorator — injects user from request
- ✅ `@Roles()` decorator — sets required role metadata
- ✅ `UserRole` enum — `WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE`
- ✅ `ShopType` enum — `WAREHOUSE`, `SHOP`
- ✅ Global `ValidationPipe` — whitelist, forbidNonWhitelisted, transform
- ✅ `@nestjs/swagger` — Swagger UI at `/api`, bearer auth configured
- ✅ All feature modules imported in `AppModule`
- ✅ Repository layer — 3-tier architecture enforced (`Controller → Service → Repository → DatabaseService`)
  - `UsersRepository` — real implementation (`findByEmail` with shop JOIN, `insertUser`, supports transactional client)
  - `ShopsRepository` — real implementation (`findAll`, `findById`, `update`, `updateStatus`)
  - `CategoriesRepository` — real implementation (`findAll`, `findAllByShop`, `findAllForShop`, `findById`, `findByNameAndShop`, `insert`, `update`, `deleteById`, `hasProducts`)
  - `ProductsRepository` — real implementation (`findPaginatedAdmin`, `findPaginatedForShop`, `findById`, `findByBarcodeAndShop`, `categoryAccessible`, `insert`, `update`, `softDelete`)
  - `InventoryRepository` — real implementation (`findPaginated`, `findAllForAdmin`, `findById`, `findLowStock`, `findAllLowStockForAdmin`, `findByShopAndProduct`, `upsertStockIn`, `adjust`) — now exported for use by OrdersService
  - `AuditLogsRepository` — real implementation (`insert` with optional transactional client, `findPaginated` with 8 filters, `findById`)
  - `NotificationsRepository` — real implementation (`insert`, `findPaginatedForShop`, `markRead`, `markAllRead`, `hasUnreadLowStock`)
  - `OrdersRepository` — real implementation (`findWarehouseShop`, `insert`, `insertItems`, `findPaginated`, `findById`, `updateStatus`, `findItemsByOrderId`)
  - Stub repositories created for: warehouse
- ✅ Migration 05 — seeds `WAREHOUSE_ADMIN` account (`admin@warehouse.com` / `Admin@123`)
- ✅ Migration 06 — adds `is_active` column to `shops` table
- ✅ Migration 07 — adds `updated_at` column to `categories` table
- ✅ Migration 08 — links `WAREHOUSE_ADMIN` to the warehouse shop (`shop_id = 1`)
- ✅ Migration 10 — adds `low_stock_threshold INTEGER NOT NULL DEFAULT 10` to `inventory` table
- ✅ Shops module — full CRUD + soft delete, role-scoped access, login blocked for inactive shops
- ✅ Categories module — full CRUD, warehouse categories are global (visible to all shops), deletion blocked when products assigned
- ✅ Products module — full CRUD + soft delete, paginated + filtered, source auto-set from shop type, warehouse products visible to all shops
- ✅ Inventory module — stock-in (upsert), adjustment (with negative guard), low-stock detection, role-scoped access, all mutations wrapped in DB transactions with audit log
- ✅ Audit logs module — `AuditLogsService.log()` shared service, supports transactional client, consumed by inventory and orders modules
- ✅ Orders module — full order lifecycle (PENDING→PROCESSING→SHIPPED→RECEIVED→COMPLETED), role-scoped access, inventory transfer on RECEIVED inside a single transaction, three audit log entries per transfer
- ✅ Audit logs module — `GET /audit-logs` with 8 filters (shop, user, type, action, entityType, entityId, date range), `GET /audit-logs/:id`, role-scoped access
- ✅ Notifications module — shop-scoped feed, three automatic triggers (order created, status changed, low stock with de-duplication), mark-read and mark-all-read endpoints

### Not Done

All planned tickets complete.

---

## What to Build Next

