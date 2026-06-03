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

## Database Schema

5 migrations in `src/database/migrations/`, run in filename order, each wrapped in a transaction.

| Table | Key Columns | Notes |
|---|---|---|
| `shops` | `id`, `name`, `address`, `phone` | No `wallet_balance` — balance derived from `audit_logs` |
| `users` | `id`, `shop_id?`, `name`, `email`, `password_hash`, `role` | `shop_id` nullable — warehouse owner has no shop |
| `categories` | `id`, `shop_id`, `name` | Per-shop |
| `products` | `id`, `category_id`, `shop_id`, `name`, `barcode`, `source` | `source`: `WAREHOUSE` or `LOCAL` |
| `inventory` | `id`, `shop_id`, `product_id`, `current_quantity` | Unique on `(shop_id, product_id)` |
| `orders` | `id`, `shop_id`, `status`, `total_items` | Status: `PENDING → PROCESSING → SHIPPED → RECEIVED → COMPLETED` |
| `order_items` | `id`, `order_id`, `product_id`, `quantity`, `price` | |
| `notifications` | `id`, `shop_id`, `user_id`, `title`, `type`, `is_read` | |
| `audit_logs` | `id`, `shop_id`, `user_id`, `type`, `action`, `entity_type`, `amount` | Source of truth for wallet balance |

**User roles:** `OWNER` · `EMPLOYEE` · `CLIENT_ADMIN`

---

## Module Status

| Module | Module | Service | Controller | DTOs | Real Logic |
|---|---|---|---|---|---|
| app | ✅ | ✅ health | ✅ `/`, `/health` | — | ✅ |
| auth | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
| users | ✅ | ⬜ stub | ⬜ stub | ✅ `CreateUserDto` | ❌ |
| shops | ✅ | ⬜ stub | ⬜ stub | ⬜ none | ❌ |
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
- ✅ `TransformInterceptor` — wraps all responses as `{ success, data, timestamp }`
- ✅ `HttpExceptionFilter` — standardised error shape
- ✅ `PaginationDto` + `paginationUtil`
- ✅ `JwtStrategy` — reads bearer token, validates against `JWT_SECRET`
- ✅ Global `ValidationPipe` — whitelist, forbidNonWhitelisted, transform
- ✅ Docker Compose — runs migrations before app start (`migration:run && npm start`)
- ✅ `@nestjs/swagger` installed and wired — Swagger UI at `/api`
- ✅ All 10 feature modules imported in `AppModule`
- ✅ `HttpExceptionFilter` registered globally
- ✅ `TransformInterceptor` registered globally

### Not Done
- ❌ Auth guards directory exists but is empty
- ❌ Auth decorators directory exists but is empty

---

## What to Build Next (Suggested Order)

### 1. Wire Feature Modules into `AppModule`
Nothing is reachable until modules are imported. Add all feature modules to `AppModule.imports`.

### 2. Auth
- `POST /auth/register` — hash password with bcrypt, insert user
- `POST /auth/login` — verify password, sign and return JWT
- `JwtAuthGuard` — wrap `AuthGuard('jwt')`
- `@CurrentUser()` decorator — extract user from request

### 3. Users
- `GET /users/:id` — get own profile
- `PATCH /users/:id` — update profile
- `GET /users` — list users (OWNER only)

### 4. Shops
- `POST /shops` — create shop
- `GET /shops/:id` — get shop details
- `PATCH /shops/:id` — update shop

### 5. Products + Categories
- Full CRUD for both
- Pagination support (infrastructure already exists)
- Filter by `source` (WAREHOUSE / LOCAL)

### 6. Inventory
- `GET /inventory` — list stock levels per shop
- `PATCH /inventory/:id` — adjust quantity
- Low-stock detection against `reorder_level`

### 7. Orders
- `POST /orders` — create order, deduct inventory
- `PATCH /orders/:id/status` — transition order status
- `GET /orders` — list with filters (status, date range)

### 8. Audit Logs
- Write an audit entry on every stock/order/payment change
- `GET /audit-logs` — query by shop, user, entity, date
- Compute wallet balance from `amount` entries

### 9. Notifications
- Wire real email/SMS/push on order status changes
- `GET /notifications` — list for current user
- `PATCH /notifications/:id/read` — mark as read

### 10. Swagger
- Add `DocumentBuilder` in `main.ts`
- Add `@ApiProperty()` to all DTOs and entities
- Add `@ApiBearerAuth()` to protected routes
