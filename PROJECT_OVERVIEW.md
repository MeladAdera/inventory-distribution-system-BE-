# Inventory Distribution System — Backend

## What This Is

A REST API that runs the full supply chain of a retail chain: **one central warehouse
distributing stock to multiple shops**, with inventory, ordering, pricing, and reporting
all tracked in one place. Built with NestJS + PostgreSQL.

Think of a small chain with a warehouse and several branch shops. The warehouse stocks
products and sets a catalog; each shop browses that catalog, orders what it needs, receives
shipments into its own inventory, sells/consumes stock, and reports back up through
analytics. This backend is the system of record for all of that.

## Why It Exists

Without it, a multi-shop operation ends up tracking stock in spreadsheets or disconnected
per-shop tools — no shared product catalog, no audit trail of who changed what stock and
when, no visibility into which shop is consuming what, and no controlled workflow for
moving inventory from the warehouse to a shop. This system centralizes that:

- **One source of truth** for products, categories, and stock levels across every shop.
- **A controlled ordering pipeline** (shop requests → warehouse fulfills → stock actually
  moves) instead of ad-hoc stock adjustments.
- **A permanent audit trail** — every quantity change, anywhere, is logged and attributable.
- **Role-based control** — a warehouse admin, shop owners, and their employees each see and
  can do only what their role permits.
- **Business intelligence** — profit, consumption trends, and top products, computed from
  real transaction data instead of guesswork.

## Who Uses It (Roles)

| Role | Scope |
|---|---|
| `WAREHOUSE_ADMIN` | Sees and manages everything: all shops, the global catalog, all orders, cross-shop analytics. Provisions shop owners. |
| `SHOP_OWNER` | Manages their own shop: local products, inventory, employees, places orders to the warehouse. |
| `EMPLOYEE` | Scoped to their shop's day-to-day operations (stock, receipts) under the owner. |

There is **no public registration** — every account is created by a privileged role above it.

## Core Features

- **Users & Auth** — JWT access tokens + rotating refresh tokens (SHA-256 hashed at rest,
  30-day expiry); bcrypt-hashed passwords; no self-signup.
- **Shops** — warehouse + branch shops, soft-deletable, the warehouse shop itself can't be deactivated.
- **Categories** — per-shop, with warehouse categories shared globally (with icons for a UI catalog).
- **Products** — per-shop catalog; warehouse products are global (`source = WAREHOUSE`), shop
  products are local (`source = LOCAL`); unique name/barcode per shop.
- **Inventory** — one stock record per (shop, product); stock-in (upsert), manual adjustments,
  low-stock thresholds, per-shop cost basis (`avg_cost`) and retail price (`sale_price`).
- **Orders** — the warehouse ↔ shop distribution workflow: a shop requests stock, the order
  moves through a fixed status lifecycle, and inventory is transferred atomically only once
  the order is marked `RECEIVED`.
- **Receipts** — batch stock-consumption records (e.g. end-of-day counts, damage write-offs),
  applied atomically and immutable once created.
- **Shifts** — the shop's trading week divided into named shifts (max 4 per weekday) with
  employees assigned to them; employees clock in with the cash already in the drawer, every
  sale and payment is stamped with the shift it moved in, and clocking out compares a hand
  count against a server-computed total. One employee works one shift, enforced as one open
  session per shop.
- **Audit Logs** — append-only, queryable history of every inventory-affecting event system-wide.
- **Notifications** — triggered on order creation, order status changes, and low stock.
- **Analytics** — top products, consumption trends, per-shop consumption, and cost/profit
  reporting, all computed from transaction snapshots rather than live product prices.
- **i18n** — every error message is translated (English/Arabic) based on the caller's requested language.

## Technologies to Know

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Framework | NestJS 10 (modules, controllers, services, guards, pipes, interceptors) |
| Database | PostgreSQL, via raw/TypeORM-style repositories + a custom SQL migration runner (`npm run migration:create` / `migration:run`) |
| Auth | JWT (`@nestjs/jwt`, Passport, `passport-jwt`) + refresh-token rotation |
| Validation | `class-validator` / `class-transformer`, enforced globally via a validation pipe |
| Passwords | `bcrypt` |
| i18n | `nestjs-i18n` (translation keys thrown by services, resolved at the response layer) |
| API docs | Swagger/OpenAPI, served at `/api` |
| File uploads | `multer` (product/category images) |
| Rate limiting | `@nestjs/throttler` |
| Testing | Jest (`@nestjs/testing`) |
| Tooling | ESLint + Prettier, Husky + lint-staged pre-commit hooks |
| Infra | Docker + docker-compose (app + Postgres) |

## Where to Read More

Each feature has a dedicated write-up in [`docs/features/`](docs/features/) — start with
`01-users.md` through `20-shifts.md` in order; they build on each other (e.g. inventory
pricing in `14` extends the model introduced in `13`, and shifts in `20` build on receipts
in `11` and debts in `17`).
[`API_REFERENCE.md`](API_REFERENCE.md) documents every endpoint.

Frontend handoffs live at the repo root, one per feature area:
[`FRONTEND_HANDOFF.md`](FRONTEND_HANDOFF.md) (auth, envelope, pagination),
[`DEBTS_HANDOFF.md`](DEBTS_HANDOFF.md),
[`SUPPLIER_INVOICE_ITEMS_HANDOFF.md`](SUPPLIER_INVOICE_ITEMS_HANDOFF.md) and
[`SHIFTS_HANDOFF.md`](SHIFTS_HANDOFF.md).
