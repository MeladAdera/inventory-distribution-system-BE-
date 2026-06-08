# Project Status — Inventory Distribution System BE

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24, NestJS 10, TypeScript 5 |
| Database | PostgreSQL 16 — raw SQL via `pg` (no ORM) |
| Auth | Passport + JWT (`@nestjs/jwt`, `passport-jwt`, `bcrypt`) |
| Rate Limiting | `@nestjs/throttler` — 100 req/min global, 5 req/min on `POST /auth/login` |
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
| `refresh_tokens` | `id`, `user_id`, `token_hash`, `expires_at`, `created_at`, `revoked_at` | SHA-256 hash only; `revoked_at NULL` = active |
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
| auth | ✅ | ✅ login, refresh, logout | ✅ `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` | ✅ `LoginDto`, `RefreshTokenDto` | ✅ |
| users | ✅ | ✅ provisioning + full CRUD | ✅ `POST /users/shop-owners`, `POST /users/employees`, `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `DELETE /users/:id` | ✅ `CreateShopOwnerDto`, `CreateEmployeeDto`, `UserQueryDto`, `UpdateUserDto` | ✅ |
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
- ✅ Migration 11 — creates `refresh_tokens` table (user_id FK, token_hash, expires_at, revoked_at, indexed)
- ✅ Shops module — full CRUD + soft delete, role-scoped access, login blocked for inactive shops
- ✅ Categories module — full CRUD, warehouse categories are global (visible to all shops), deletion blocked when products assigned
- ✅ Products module — full CRUD + soft delete, paginated + filtered, source auto-set from shop type, warehouse products visible to all shops
- ✅ Inventory module — stock-in (upsert), adjustment (with negative guard), low-stock detection, role-scoped access, all mutations wrapped in DB transactions with audit log
- ✅ Audit logs module — `AuditLogsService.log()` shared service, supports transactional client, consumed by inventory and orders modules
- ✅ Orders module — full order lifecycle (PENDING→PROCESSING→SHIPPED→RECEIVED→COMPLETED), role-scoped access, inventory transfer on RECEIVED inside a single transaction, three audit log entries per transfer
- ✅ Audit logs module — `GET /audit-logs` with 8 filters (shop, user, type, action, entityType, entityId, date range), `GET /audit-logs/:id`, role-scoped access
- ✅ Notifications module — shop-scoped feed, three automatic triggers (order created, status changed, low stock with de-duplication), mark-read and mark-all-read endpoints

---

## Security & Quality Hardening (post-MVP)

- ✅ **Rate limiting** — `ThrottlerModule` registered globally via `APP_GUARD`; `POST /auth/login` capped at 5 req/60 s per IP (brute-force protection); all other endpoints capped at 100 req/60 s
- ✅ **CORS** — explicit `enableCors()` in `main.ts`; origins controlled by `ALLOWED_ORIGINS` env var (comma-separated); defaults to `http://localhost:3001` in development
- ✅ **JWT secret validation** — `JwtModule` switched to `registerAsync()` + `ConfigService.getOrThrow('JWT_SECRET')`; app refuses to start if `JWT_SECRET` is missing; no plaintext fallback remains
- ✅ **Shared `RequestUser` interface** — single source of truth at `src/common/interfaces/request-user.interface.ts`, re-exported from `src/common`; removed 11 duplicate local declarations across services and controllers
- ✅ **Inventory transaction bug** — `findById` inside `stockIn` and `adjust` transactions now passes the active `PoolClient` so the read sees uncommitted writes on the same connection
- ✅ **Negative-stock race condition** — `InventoryRepository.adjust` SQL adds `AND current_quantity + $1 >= 0` guard; returns `null` on conflict; service throws `BadRequestException` instead of allowing negative inventory under concurrent load
- ✅ **Hardcoded shop ID removed from notifications** — `NotificationsService` previously hardcoded `shopId = 1` for `WAREHOUSE_ADMIN`; now uses `user.shopId` (set correctly for all users including admin via migration 08); removed dead role-check ternary and unused `UserRole` import
- ✅ **`any` type removed from `AuthController.getMe`** — parameter now typed as `RequestUser` using `import type`
- ✅ **Env schema wired up** — `env.schema.ts` rewritten to match vars the app actually reads (`DATABASE_HOST/PORT/USERNAME/PASSWORD/NAME`, `JWT_SECRET` required, `ALLOWED_ORIGINS`, `SMTP_*` optional); `validate` now passed to `ConfigModule.forRoot()` so the app validates env at startup
- ✅ **Redundant `dotenv.config()` removed** — `main.ts` no longer manually loads the env file; `ConfigModule` handles it; eliminated the double-load and the fragile ordering dependency
- ✅ **N+1 queries eliminated in order creation and inventory transfer** — `InventoryRepository.findByShopAndProducts` batch-fetches all products in one `ANY($2)` query; `createOrder` drops from N queries → 1; `transferInventory` batch-fetches warehouse and shop inventory (2 queries instead of 2N), all stock validation now happens in memory before any writes

- ✅ **Refresh token system** — `refresh_tokens` table, SHA-256 hashed opaque tokens, atomic rotation in single DB transaction, all-device logout via `revokeAllForUser`, access token expiry reduced to 15 min

### Not Done

All planned tickets complete.

---

## What to Build Next

- ⬜ Warehouse dashboard stats — `GET /warehouse/stats` (pending orders count, low-stock count, total shops, total products)
- ⬜ Change password endpoint — `PATCH /users/:id/password` (current password verification + bcrypt rehash)
