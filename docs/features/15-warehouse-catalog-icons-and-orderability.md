# Warehouse Catalog — Icons, Add-to-Inventory, Seed Data, and Orderability — Feature Documentation

## Overview

This feature turns the warehouse's global products into a real **browsable catalog** for shop owners, closing four gaps in the existing [04-categories.md](./04-categories.md) / [05-products.md](./05-products.md) / [06-inventory.md](./06-inventory.md) / [07-orders.md](./07-orders.md) model:

1. **Categories had no visual identity.** The catalog UI needs an icon per category (e.g. a cigarette icon for "دخان", a coffee cup for "مشروبات ساخنة"); previously the only visual field was `image_url`, meant for an uploaded image, not a category glyph.
2. **Browsing the catalog and stocking it were the same action.** A shop owner had no way to register a warehouse product onto their own inventory *without* it counting as a stock movement — every existing inventory-writing endpoint (`stock-in`, `adjust`) either moves real stock or corrects a count.
3. **Dev data was demo data, not a catalog.** The seed produced a handful of made-up SKUs across 4 shops. The warehouse needed a real product catalog (categories + product names) to seed its global catalog with.
4. **Catalog-only products were indistinguishable from real warehouse stock.** Once (3) seeded 140 catalog templates, every `GET /products` caller — including the shop-facing **Order** page — saw them mixed in with products the warehouse actually stocks and can fulfill. A shop could pick a catalog-only item in the order UI and only find out it fails at submit time. See Part 4.

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

## Part 4 — `products.is_orderable`: Separating Catalog from Real Warehouse Stock

### The problem this closes

Part 3 seeded 140 real-looking products with `source = 'WAREHOUSE'` and zero inventory anywhere. From the API's point of view they were **identical** to a genuinely stocked warehouse product like a laptop the admin actually buys, stocks, and ships to shops. `GET /products` (the same endpoint the Order page's item picker uses) returned both with no way to tell them apart — a shop could add a catalog item to the order, and the *only* signal it wouldn't work was the order failing at submit time with `orders.PRODUCT_NOT_IN_WAREHOUSE`.

### The fix — an explicit column, not an inferred one

`products.is_orderable BOOLEAN NOT NULL DEFAULT TRUE` (`05-ProductIsOrderable.sql`). `TRUE` for every real product (existing rows, and anything the admin creates from now on); the 140 seeded catalog rows are explicitly `FALSE`.

This deliberately **is not** derived from "does the warehouse have an inventory row for it" (which is what Part 3's last design note originally argued for). Two reasons it moved to an explicit column instead:

1. **A real, out-of-stock product must stay orderable.** A laptop the warehouse has sold out of still has an inventory row (`current_quantity: 0`) — it should show as "temporarily out of stock" in the order UI, not disappear or be flagged the same as a catalog-only template. Inferring orderability from row-presence can't express "this is real stock, just depleted"; an explicit flag can.
2. **Admins need to pull a product from ordering without touching its stock.** E.g., discontinuing a supplier relationship — the flag can flip to `false` on a product with real, non-zero inventory, which "has an inventory row" alone cannot represent.

### Where it's enforced

- **Order creation** (`OrdersService.createOrder`): the row-locking query `InventoryRepository.findByShopAndProductsForUpdate` now also selects `p.is_orderable`. Each item is checked — `false` throws `400 orders.PRODUCT_NOT_ORDERABLE` — **before** the stock-quantity check, so a non-orderable-but-in-stock product is still rejected even though it would otherwise pass. Catalog items with no inventory row at all still hit the pre-existing `PRODUCT_NOT_IN_WAREHOUSE` check first (unchanged) — the new check only matters once a product does have warehouse stock.
- **Product create/update** (`POST /products`, `PATCH /products/:id`): `is_orderable` is a normal optional field on both DTOs, defaulting to `true` on create.
- **Filtering** (`GET /products?is_orderable=true|false`): added to both `findPaginatedAdmin` and `findPaginatedForShop` alongside the existing `source`/`category_name` filters. This is what lets the **Order page picker** query only real, fulfillable products directly from the endpoint it already uses — no separate warehouse-availability endpoint needed.

### Verified end-to-end (dev, live server)

| Step | Result |
|---|---|
| Order a catalog-only product (no warehouse inventory row) | `400 PRODUCT_NOT_IN_WAREHOUSE` (pre-existing check) |
| Stock-in that same product at the warehouse, order again | `400 PRODUCT_NOT_ORDERABLE` (new check — proves it fires independently of stock) |
| `PATCH /products/:id { is_orderable: true }`, order again | `201` — order created |
| `GET /products?is_orderable=true` / `?is_orderable=false` | Correctly split 1 / 139 on the reseeded catalog |

---

## Migrations

| File | What it does |
|---|---|
| `04-CategoryIcon.sql` | Adds `categories.icon VARCHAR(100)`, nullable |
| `05-ProductIsOrderable.sql` | Adds `products.is_orderable BOOLEAN NOT NULL DEFAULT TRUE` |

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

GET   /products                      # each row now ALSO has: is_orderable (boolean)
GET   /products?is_orderable=true    # NEW filter — only products the warehouse can fulfill
POST  /products                      # accepts optional is_orderable (default true)
PATCH /products/:id                  # accepts optional is_orderable
POST  /orders                        # NEW error: 400 orders.PRODUCT_NOT_ORDERABLE
```

> `POST /inventory` and the `in_inventory`/`current_quantity` fields on `GET /products` are already documented in detail in `API_REFERENCE.md` and `FRONTEND_HANDOFF.md`. Same for `is_orderable`.

---

## File Map

```
src/database/migrations/
├── 04-CategoryIcon.sql                     categories.icon VARCHAR(100)
└── 05-ProductIsOrderable.sql               products.is_orderable BOOLEAN DEFAULT TRUE

src/categories/
├── entities/category.entity.ts             + icon: string | null
├── dto/create-category.dto.ts              + icon? (optional, ≤100 chars)
├── dto/update-category.dto.ts              + icon? (optional, ≤100 chars)
├── repositories/categories.repository.ts   insert(name, shopId, icon?), update() via COALESCE per field
└── services/categories.service.ts          create() passes icon; update() allows icon-only patches

src/products/
├── entities/product.entity.ts              + category_icon; + in_inventory? (Browse Products flag);
│                                            + is_orderable
├── dto/create-product.dto.ts               + is_orderable? (default true)
├── dto/update-product.dto.ts               + is_orderable?
├── dto/product-query.dto.ts                + is_orderable? filter (same boolean-transform as is_active)
├── repositories/products.repository.ts     + c.icon AS category_icon on all 3 read queries;
│                                            + is_orderable filter on both paginated queries;
│                                            insert(..., isOrderable = true), update() field
└── services/products.service.ts            create()/createForShop() pass dto.is_orderable through

src/inventory/
├── entities/inventory.entity.ts            InventoryWithProduct + category_id, category_name, category_icon
├── dto/add-inventory-product.dto.ts        productId (required), quantity? (default 0)
├── controllers/inventory.controller.ts     POST /inventory → addProduct
├── services/inventory.service.ts           addProduct() — scope guard + idempotent register + audit
└── repositories/inventory.repository.ts    registerProduct() — INSERT ON CONFLICT DO NOTHING;
                                             + categories LEFT JOIN on all 5 read queries;
                                             findByShopAndProductsForUpdate() + p.is_orderable

src/orders/services/orders.service.ts       createOrder() — is_orderable check before the stock check

src/receipts/
├── entities/receipt.entity.ts              ReceiptItem + category_id, category_name, category_icon
└── repositories/receipts.repository.ts     findById() JSON_BUILD_OBJECT + categories LEFT JOIN

src/database/seeders/seed.ts                 replaced demo multi-shop data with the warehouse catalog
                                             (single CATALOG array: 9 categories, 140 products,
                                             all seeded is_orderable = FALSE)

i18n/{en,ar}/orders.json                     + PRODUCT_NOT_ORDERABLE
```

---

## Error Keys (i18n)

`POST /inventory` reuses existing `inventory.*` keys. `POST /orders` gets one new key.

| Key | HTTP | Thrown when |
|---|---|---|
| `inventory.PRODUCT_NOT_FOUND` | 404 | `productId` does not reference an active product |
| `inventory.PRODUCT_NOT_IN_SCOPE` | 403 | Product belongs to another shop and isn't a `WAREHOUSE` product |
| `orders.PRODUCT_NOT_ORDERABLE` | 400 | An order item references a product with `is_orderable: false` |

> See `docs/features/10-i18n-localization.md` for how keys are detected and translated.

---

## Key Design Decisions

### Why not validate `icon` against an enum?

The icon set is a frontend concern (which Lucide icons are curated/supported) and changes independently of the backend. Storing a free string keeps the backend from needing a deploy every time the frontend adds a new icon to its picker; the frontend's `getCategoryIcon`-style fallback absorbs unknown/`null` values.

### Why derive `category_icon` via `LEFT JOIN` instead of caching it on `products`?

Same reasoning as `category_name` (already joined, not denormalized): one place to change an icon (`PATCH /categories/:id`) instantly reflects everywhere it's displayed, with no risk of a cached copy drifting out of sync.

### Why is a "catalog-only" product allowed to have zero inventory anywhere?

This is intentional, not an oversight — a warehouse product row represents **item-master data** (name, category, barcode template), not a stock guarantee. `POST /inventory` (Part 2) already avoids forcing a phantom zero-stock row onto a **shop's** inventory just to register interest in a product; catalog-only warehouse products are the same idea one level up — a product can be fully defined with no inventory row anywhere.

### Why `is_orderable` as a column instead of just checking for a warehouse inventory row?

This was the original plan (see the reasoning above) until Part 4 found a case it can't cover: a real product that's legitimately out of stock. If "orderable" were inferred purely from "a warehouse inventory row exists," a depleted real product and a catalog-only template would look identical — both show no purchasable stock. An explicit column keeps those two states distinct: `is_orderable: true` + `current_quantity: 0` = "we sell this, we're just out"; `is_orderable: false` = "this was never real warehouse stock to begin with." The column is the source of truth for *intent*; the inventory row (or lack of one) is still what blocks the order transactionally.
