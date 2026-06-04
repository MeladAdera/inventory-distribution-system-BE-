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

7 migrations in `src/database/migrations/`, run in filename order.

| Table | Key Columns | Notes |
|---|---|---|
| `shops` | `id`, `name`, `address`, `phone`, `type`, `is_active` | `type`: `WAREHOUSE` or `SHOP` |
| `users` | `id`, `shop_id?`, `name`, `email`, `password_hash`, `role` | `shop_id` nullable for `WAREHOUSE_ADMIN` |
| `categories` | `id`, `shop_id`, `name` | Per-shop |
| `products` | `id`, `category_id`, `shop_id`, `name`, `barcode`, `source` | `source`: `WAREHOUSE` or `LOCAL` |
| `inventory` | `id`, `shop_id`, `product_id`, `current_quantity` | Unique on `(shop_id, product_id)` |
| `orders` | `id`, `from_shop_id`, `to_shop_id`, `status`, `total_items` | Supports warehouse ↔ shop direction |
| `order_items` | `id`, `order_id`, `product_id`, `quantity`, `price` | |
| `notifications` | `id`, `shop_id`, `user_id`, `title`, `type`, `is_read` | |
| `audit_logs` | `id`, `shop_id`, `user_id`, `type`, `action`, `entity_type`, `amount` | Source of truth for wallet balance |

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
| products | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
| categories | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
| orders | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
| inventory | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
| warehouse | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
| audit-logs | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
| notifications | ✅ | ⬜ stub (email/sms/push) | — | ⬜ none | ❌ |

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
- ✅ All 10 feature modules imported in `AppModule`
- ✅ Repository layer — 3-tier architecture enforced (`Controller → Service → Repository → DatabaseService`)
  - `UsersRepository` — real implementation (`findByEmail` with shop JOIN, `insertUser`, supports transactional client)
  - `ShopsRepository` — real implementation (`findAll`, `findById`, `update`, `updateStatus`)
  - Stub repositories created for: products, categories, orders, inventory, warehouse, audit-logs
- ✅ Migration 05 — seeds `WAREHOUSE_ADMIN` account (`admin@warehouse.com` / `Admin@123`)
- ✅ Migration 06 — adds `is_active` column to `shops` table
- ✅ Shops module — full CRUD + soft delete, role-scoped access, login blocked for inactive shops

### Not Done
- ❌ Products + Categories CRUD
- ❌ Inventory management
- ❌ Orders (warehouse ↔ shop flow)
- ❌ Audit logs
- ❌ Notifications

---

## What to Build Next

### Ticket 4 — Products + Categories
- Full CRUD for categories (per-shop)
- Full CRUD for products with pagination
- Filter by `source` (WAREHOUSE / LOCAL)

### Ticket 5 — Inventory
- `GET /inventory` — list stock levels for current shop
- `PATCH /inventory/:id` — adjust quantity
- Low-stock detection

### Ticket 6 — Orders
- `POST /orders` — shop creates order request to warehouse
- `PATCH /orders/:id/status` — warehouse transitions status
- `GET /orders` — list with filters

### Ticket 7 — Audit Logs + Notifications
- Audit entry on every stock/order change
- `GET /audit-logs` — query by shop, date
- Notification triggers on order status change
