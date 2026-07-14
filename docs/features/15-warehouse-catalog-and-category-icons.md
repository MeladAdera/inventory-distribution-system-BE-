# Warehouse Catalog — Icons, Add-to-Inventory, and Seed Data — Feature Documentation

## Overview

This feature turns the warehouse's global products into a real **browsable catalog** for shop owners, closing three gaps in the existing [04-categories.md](./04-categories.md) / [05-products.md](./05-products.md) / [06-inventory.md](./06-inventory.md) model:

1. **Categories had no visual identity.** The catalog UI needs an icon per category (e.g. a cigarette icon for "دخان", a coffee cup for "مشروبات ساخنة"); previously the only visual field was `image_url`, meant for an uploaded image, not a category glyph.
2. **Browsing the catalog and stocking it were the same action.** A shop owner had no way to register a warehouse product onto their own inventory *without* it counting as a stock movement — every existing inventory-writing endpoint (`stock-in`, `adjust`) either moves real stock or corrects a count.
3. **Dev data was demo data, not a catalog.** The seed produced a handful of made-up SKUs across 4 shops. The warehouse needed a real product catalog (categories + product names) to seed its global catalog with.

---

## Part 1 — Category Icons (`categories.icon`)

### What changed

`categories` gets a new nullable column, `icon`, holding a **Lucide icon name** (`"Cigarette"`, `"CupSoda"`, `"Coffee"`, …) — a short identifier, not a file, so it doesn't reuse `image_url`.

```sql
-- 04-CategoryIcon.sql
ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon VARCHAR(100);
```

- `icon` is **not validated against a fixed enum** server-side — it's a free string (≤100 chars). The frontend owns the curated icon set and falls back to a default icon for `null`/unrecognized values.
- `CreateCategoryDto` / `UpdateCategoryDto`: `icon` is optional. `PATCH` supports an **icon-only** update — the repository `UPDATE` uses `COALESCE(new, existing)` per field, so sending just `{ "icon": "Coffee" }` no longer requires re-sending `name` (previously the update SQL always overwrote `name`, so an undefined name was rejected before it could reach the query — see `categories.service.ts`).

### Propagation to every catalog-facing response

A category's icon is useless if only `GET /categories` returns it — cards on inventory pages, product pages, and receipts also need to render it. `c.icon AS category_icon` was added to every query that already joins `categories` for `category_name`:

| Module | Query | Added |
|---|---|---|
| `products.repository.ts` | `findPaginatedAdmin`, `findPaginatedForShop`, `findById` | `category_icon` |
| `inventory.repository.ts` | `findPaginated`, `findAllForAdmin`, `findById`, `findLowStock`, `findAllLowStockForAdmin` | `category_id`, `category_name`, `category_icon` (inventory previously joined `products` only, never `categories`) |
| `receipts.repository.ts` | `findById` (per receipt item, via `JSON_BUILD_OBJECT`) | `category_id`, `category_name`, `category_icon` |

All three are `LEFT JOIN` / nullable — a product with no category returns `null` for all three fields, never a join failure.

---

## Part 2 — Add a Catalog Product to Inventory Without Stock Movement

### The problem

The existing browse flow (`GET /products` for a shop) already decorates each warehouse product with `in_inventory` (does this shop track it?) and `current_quantity` (this shop's stock, `0` if not tracked) — see `product.entity.ts`. But there was no **action** behind the "Add" button: the only way to get a product into `inventory` was `stock-in`, which is cost-bearing (blends `avg_cost`) and implies real stock arrived. Registering "I want to carry this" is a different action from "stock arrived."

### `POST /inventory` — register, don't stock

**Roles:** `SHOP_OWNER`, `EMPLOYEE`.

```json
{ "productId": 4, "quantity": 0 }
```

- Creates the inventory row at `quantity` (default `0`), seeding `avg_cost`/`sale_price` from the product — same seed values `upsertStockIn`'s `INSERT` half uses — so the row is ready to sell once stock actually arrives (via the orders flow).
- **Not cost-bearing**: unlike `stock-in`, there's no blend — it's a first-time `INSERT`, never a `DO UPDATE`.
- **Idempotent**: `InventoryRepository.registerProduct` uses `ON CONFLICT (shop_id, product_id) DO NOTHING`. If the row already exists, the insert returns no row, and the service re-fetches and returns the existing record untouched — no duplicate, no audit entry, no error.
- **Scope guard**: reuses the same rule as `stock-in` — the product must be the shop's own or a `WAREHOUSE` (global) product; a 403 (`inventory.PRODUCT_NOT_IN_SCOPE`) blocks registering another shop's private product.
- Writes an audit log (`type: INVENTORY`, `action: PRODUCT_ADDED`) only when a new row is actually created.

### Why this needed a new endpoint instead of reusing `stock-in`

`stock-in` with `quantity: 0` would have been rejected (`quantity` must be positive there) and, more importantly, means something different: "stock arrived, count is zero" is not a real event, whereas "track this product, no stock yet" is. Separating the two keeps `avg_cost` blending logic (see [14-inventory-cost-and-pricing.md](./14-inventory-cost-and-pricing.md)) untouched — this endpoint never runs it.

---

## Part 3 — Warehouse Catalog Seed Data

`seed.ts` no longer produces multi-shop demo data (shops, users, orders, notifications, audit logs). It now seeds **only**:

- The warehouse shop (`id 1`) and its admin (`admin@warehouse.com` / `Admin@123`).
- **9 categories**, each with an `icon`, and **140 global warehouse products** under them — a real convenience-store catalog (tobacco, hookah supplies, cold/hot drinks, groceries, biscuits, candy, snacks, misc).

All 140 products are created with `is_global = TRUE`, `source = 'WAREHOUSE'`, `price`/`cost_price = 0` (filled in later per product), and **no inventory row** — they exist purely as catalog entries until the warehouse actually stocks one (via `stock-in`, which is a separate, deliberate action).

The seed structure is a single `CATALOG` array of `{ name, icon, products: string[] }` — adding a category or product going forward means editing that array, not hand-writing SQL inserts.

---

## Migrations

| File | What it does |
|---|---|
| `04-CategoryIcon.sql` | Adds `categories.icon VARCHAR(100)`, nullable |

---

## API Summary (frontend-facing)

```
GET   /categories                    # each row now has: icon (string | null)
POST  /categories                    # { name, icon? }
PATCH /categories/:id                # { name?, icon? } — icon-only update allowed

GET   /products                      # each row now has: category_icon (string | null)
GET   /inventory                     # each row now has: category_id, category_name, category_icon
GET   /inventory/low-stock           # same
GET   /inventory/:id                 # same
GET   /receipts/:id                  # each item in items[] now has: category_id, category_name, category_icon

POST  /inventory                     # NEW — { productId, quantity? } → register a catalog product
                                      #   at qty 0 (or opening balance), idempotent, no cost blend
```

> `POST /inventory` and the `in_inventory`/`current_quantity` fields on `GET /products` are already documented in detail in `API_REFERENCE.md` and `FRONTEND_HANDOFF.md`.

---

## File Map

```
src/database/migrations/
└── 04-CategoryIcon.sql                     categories.icon VARCHAR(100)

src/categories/
├── entities/category.entity.ts             + icon: string | null
├── dto/create-category.dto.ts              + icon? (optional, ≤100 chars)
├── dto/update-category.dto.ts              + icon? (optional, ≤100 chars)
├── repositories/categories.repository.ts   insert(name, shopId, icon?), update() via COALESCE per field
└── services/categories.service.ts          create() passes icon; update() allows icon-only patches

src/products/
├── entities/product.entity.ts              + category_icon; + in_inventory? (Browse Products flag)
└── repositories/products.repository.ts     + c.icon AS category_icon on all 3 read queries

src/inventory/
├── entities/inventory.entity.ts            InventoryWithProduct + category_id, category_name, category_icon
├── dto/add-inventory-product.dto.ts        productId (required), quantity? (default 0)
├── controllers/inventory.controller.ts     POST /inventory → addProduct
├── services/inventory.service.ts           addProduct() — scope guard + idempotent register + audit
└── repositories/inventory.repository.ts    registerProduct() — INSERT ON CONFLICT DO NOTHING;
                                             + categories LEFT JOIN on all 5 read queries

src/receipts/
├── entities/receipt.entity.ts              ReceiptItem + category_id, category_name, category_icon
└── repositories/receipts.repository.ts     findById() JSON_BUILD_OBJECT + categories LEFT JOIN

src/database/seeders/seed.ts                 replaced demo multi-shop data with the warehouse catalog
                                             (single CATALOG array: 9 categories, 140 products)
```

---

## Error Keys (i18n)

No new keys — `POST /inventory` reuses existing `inventory.*` keys.

| Key | HTTP | Thrown when |
|---|---|---|
| `inventory.PRODUCT_NOT_FOUND` | 404 | `productId` does not reference an active product |
| `inventory.PRODUCT_NOT_IN_SCOPE` | 403 | Product belongs to another shop and isn't a `WAREHOUSE` product |

> See `docs/features/10-i18n-localization.md` for how keys are detected and translated.

---

## Key Design Decisions

### Why not validate `icon` against an enum?

The icon set is a frontend concern (which Lucide icons are curated/supported) and changes independently of the backend. Storing a free string keeps the backend from needing a deploy every time the frontend adds a new icon to its picker; the frontend's `getCategoryIcon`-style fallback absorbs unknown/`null` values.

### Why derive `category_icon` via `LEFT JOIN` instead of caching it on `products`?

Same reasoning as `category_name` (already joined, not denormalized): one place to change an icon (`PATCH /categories/:id`) instantly reflects everywhere it's displayed, with no risk of a cached copy drifting out of sync.

### Why is a "catalog-only" product allowed to have zero inventory anywhere?

This is intentional, not an oversight — a warehouse product row represents **item-master data** (name, category, barcode template), not a stock guarantee. Whether the warehouse actually carries physical stock of it is answered by a **separate fact**: does a `warehouse` `inventory` row exist for it (created via `stock-in`)? Conflating "the product is defined" with "the warehouse stocks it" would force every catalog entry to carry a phantom zero-stock inventory row at the warehouse, which is exactly what `POST /inventory` avoids for **shops** — the same principle applies to the warehouse itself.
