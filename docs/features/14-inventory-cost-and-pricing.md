# Inventory-Level Cost & Per-Shop Pricing — Feature Documentation

## Overview

This feature evolves the cost/price model from [13-cost-price-profit.md](./13-cost-price-profit.md). Previously **cost and selling price were single global values on `products`**, snapshotted into transaction rows. That model could not represent two real situations:

1. **Stock acquired at different costs over time.** Adding a new batch at a new cost either overwrote the product cost (distorting profit on units already in stock) or was ignored. There was no per-stock cost basis.
2. **A shop setting its own retail price** on a warehouse product. `products.price` is shared across every shop stocking that product, so a shop owner could not price independently.

Both are solved by moving cost and price **onto the inventory row** — one value per `(shop, product)`:

| Concern | Global (`products`) — now a *default* | Per-shop (`inventory`) — **new source of truth** |
|---------|----------------------------------------|--------------------------------------------------|
| Cost basis | `cost_price` — catalog / seed value | **`avg_cost`** — moving weighted average, `DECIMAL(10,4)` |
| Selling price | `price` — warehouse list / seed value | **`sale_price`** — per-shop retail price, `DECIMAL(10,2)` |

Orders and sales now snapshot the **per-shop** values, so the profit analytics in doc 13 need **no changes** — they still read `order_items` / `receipt_items` snapshots, which now carry accurate per-shop numbers. This **resolves doc 13's "shop margin on warehouse products" limitation**.

---

## Part 1 — Moving-Average Cost (`inventory.avg_cost`)

### The formula

When `addQty` units arrive at `addCost` each on top of `oldQty` units valued at `oldAvg`:

```
new_avg = (oldQty × oldAvg + addQty × addCost) / (oldQty + addQty)
```

- **First batch** (`oldQty = 0`): `new_avg = addCost`.
- **Removing stock** (sales, negative adjustments): `avg_cost` is **never** changed — the unit cost of the remaining units is unchanged by definition.

Stored at **4 decimals** on purpose: `avg_cost` is a cost *basis/rate* that feeds back into itself on every blend, so rounding at 2 dp would compound and permanently bias reported profit. Settled amounts (price columns, totals) stay at 2 dp.

### Where the blend runs

`InventoryRepository.upsertStockIn` — the moving average is computed **inside** the `INSERT … ON CONFLICT DO UPDATE`, so two concurrent stock-ins (or the first-ever stock-in racing itself) cannot corrupt it:

```sql
INSERT INTO inventory (shop_id, product_id, current_quantity, avg_cost, sale_price)
VALUES ($1, $2, $3,
        COALESCE($4::numeric, (SELECT cost_price FROM products WHERE id = $2), 0),
        COALESCE((SELECT price FROM products WHERE id = $2), 0))
ON CONFLICT (shop_id, product_id)
DO UPDATE SET
  avg_cost = CASE
    WHEN $4::numeric IS NULL THEN inventory.avg_cost
    ELSE ROUND(
      (inventory.current_quantity * inventory.avg_cost + EXCLUDED.current_quantity * $4::numeric)
      / NULLIF(inventory.current_quantity + EXCLUDED.current_quantity, 0), 4)
  END,
  current_quantity = inventory.current_quantity + EXCLUDED.current_quantity,
  updated_at = NOW();
```

Every cost-bearing stock increase funnels through this one method: manual stock-in, order received into a shop, and stock returned to the warehouse on a cancelled order.

### The `unitCost` tri-state (`POST /inventory/stock-in`)

```jsonc
{ "productId": 12, "quantity": 50, "unitCost": 8.0, "notes": "..." }
```

`unitCost` is deliberately three-valued so an empty field can never silently tank the cost basis:

| Sent | Meaning | Effect |
|------|---------|--------|
| **omitted** (no key) | cost unknown / inherited | new row seeds `avg_cost` from `products.cost_price`; existing row keeps its `avg_cost` (quantity still increases) |
| **`0`** | genuinely free stock (samples/promo) | blended as 0 → lowers the basis |
| **`> 0`** | a stated batch cost | blended into the average |

⚠️ Contract: **omit the key entirely — never send `null` or `""`.** The frontend prefills the field with the current avg so `0` is always a deliberate keystroke.

`adjust` (`PATCH /inventory/:id`) is **cost-neutral** — it only corrects the count and never touches `avg_cost`. (Edge case: a positive adjust on an empty row — qty 0, avg 0 — mints units at cost 0. That is an accepted correction-path outcome; use `stock-in` with a `unitCost` when stock genuinely arrived at a cost.)

### Order cost flow

`order_items.cost_price` is now sourced from the **warehouse's `avg_cost`** (via `OrdersRepository.insertItems`), not `products.cost_price`. This makes warehouse profit reflect real basis and feeds the shop a real cost on receive:

```
warehouse stock-in (supplier cost) ─blend→ warehouse.avg_cost
     └ order created ─snapshot→ order_items.cost_price
          └ order received ─blend→ shop.avg_cost
               └ sale ─snapshot→ receipt_items.cost_price ─→ profit reports
```

**Cancelled order** (`OrdersService.restoreWarehouseInventory`): returned units are re-blended into the warehouse at the cost they left with (`order_items.cost_price`), conserving total inventory value even if the warehouse average has moved since the order shipped.

---

## Part 2 — Per-Shop Selling Price (`inventory.sale_price`)

### Seed-once rule

`sale_price` is seeded from `products.price` **only when the inventory row is first created** — it is in the `INSERT` of `upsertStockIn` but **not** the `DO UPDATE`. So a later stock-in or order receipt never overwrites a price the shop owner has chosen. `products.price` becomes the warehouse list / default price.

### Setting the price — `PATCH /inventory/:id/price`

```jsonc
PATCH /inventory/42/price
{ "salePrice": 25.00 }          // must be > 0
```

- Roles: `WAREHOUSE_ADMIN`, `SHOP_OWNER`. A shop owner may only set price on **their own shop's** rows — otherwise `403 "You can only modify inventory for your own shop"`.
- Writes an `INVENTORY` / `PRICE_CHANGE` audit log entry (`amount` = new price, notes = `old → new`).
- Returns the updated `InventoryWithProduct` (including the new `sale_price`).

### Sale snapshot

`ReceiptsService.create` snapshots `inventory.sale_price` into `receipt_items.price` (and `inventory.avg_cost` into `receipt_items.cost_price`). The row-locking query `findByIdsForUpdate` no longer reads `products.price` / `products.cost_price` — both come from the inventory row via `i.*`.

> **Semantic to note:** `inventory.sale_price` is the source of truth for a sale. Editing a *local* product's `price` via `PATCH /products/:id` no longer affects its sale price — the inventory price endpoint is the single place to set selling price, uniformly for local and warehouse products.

---

## API Summary (frontend-facing)

```
GET   /inventory                     # each row now also has: avg_cost "6.0000", sale_price "25.00" (strings)
POST  /inventory/stock-in            # + optional unitCost (omit / 0 / >0); response carries authoritative avg_cost
PATCH /inventory/:id/price           # { salePrice } — shop-owner, own shop only
```

`avg_cost` (4 dp) and `sale_price` (2 dp) serialize as **strings** (pg returns `numeric` as text) — `parseFloat` them like `price`. `stock-in` stays one product per call.

---

## Migrations

| File | Change |
|------|--------|
| `01-InventoryAvgCost.sql` | `inventory.avg_cost DECIMAL(10,4)`, backfill from `products.cost_price`; widen `order_items.cost_price` / `receipt_items.cost_price` to `(15,4)` |
| `02-InventorySalePrice.sql` | `inventory.sale_price DECIMAL(10,2)`, backfill from `products.price` |

Both are forward migrations (the squashed `00` is frozen). `seed.ts` sets `avg_cost` and `sale_price` from each product so dev profit numbers are realistic.

---

## Worked Example (verified end-to-end)

| Step | Action | Result |
|------|--------|--------|
| 1 | Warehouse stock-in 100 @ 5.00, then +100 @ 7.00 | `avg_cost` 5.0000 → **6.0000** |
| 2 | Admin orders 50 → `order_items.cost_price` | **6.0000** (warehouse avg, not product 4.00) |
| 3 | Order RECEIVED → shop `avg_cost`, seeded `sale_price` | 6.0000 / **20.00** (from `products.price`) |
| 4 | Owner shop stock-in +50 @ 8.00 | `avg_cost` **7.0000** |
| 5 | Owner `PATCH /inventory/:id/price` 25.00 | `sale_price` **25.00** (product stays 20.00) |
| 6 | Owner sells 10 → `receipt_items` | price **25.00**, cost 7.00 → profit 180 |
| 7 | Later order receive + manual stock-in | `sale_price` stays **25.00** (seed-once) |
| 8 | Owner sets price on warehouse row | **403** |
| 9 | Cancel an order after warehouse avg moved 6→9 | returns 50 @ 6.00 → avg **8.4000** (value conserved) |

---

## Module Layout

```
src/database/migrations/01-InventoryAvgCost.sql      ← avg_cost column + snapshot widening
src/database/migrations/02-InventorySalePrice.sql    ← sale_price column
src/inventory/entities/inventory.entity.ts           ← avg_cost, sale_price on the entity
src/inventory/repositories/inventory.repository.ts   ← upsertStockIn (blend + seed-once), updateSalePrice
src/inventory/dto/stock-in.dto.ts                    ← unitCost tri-state
src/inventory/dto/update-sale-price.dto.ts           ← salePrice
src/inventory/{controllers,services}                 ← stock-in blend, PATCH :id/price, audit
src/orders/repositories/orders.repository.ts         ← order cost sourced from warehouse avg_cost
src/orders/services/orders.service.ts                ← blend on receive, re-blend on cancel
src/receipts/services/receipts.service.ts            ← snapshot sale_price + avg_cost
src/database/seeders/seed.ts                         ← seeds avg_cost + sale_price
```
