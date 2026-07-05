# Cost Price & Profit Analytics — Feature Documentation

## Overview

Products now carry **two prices** instead of one, enabling profit tracking for both the warehouse and the shops:

| Field | Meaning |
|-------|---------|
| `price` | **Selling price** — what the product is sold for (existing field, unchanged) |
| `cost_price` | **Buying price** — what it cost to acquire (new, `DECIMAL(10,2)`, defaults to `0`) |

Profit is never computed from the products table directly. Instead, both prices are **snapshotted into every transaction row** at the moment the transaction happens, and two new analytics endpoints aggregate those snapshots:

| Endpoint | Data source | Question it answers |
|----------|-------------|---------------------|
| `GET /analytics/profit-summary` | `order_items` or `receipt_items` | How much revenue / cost / profit in the period? |
| `GET /analytics/profit-trend` | same | How does profit evolve over time buckets? |

---

## The Snapshot Pattern

**Migration:** `04-AddCostPrice.sql` adds `cost_price` to three tables:

| Table | Role |
|-------|------|
| `products` | The *current* buying price — editable via product create/update |
| `order_items` | Snapshot taken when a shop orders from the warehouse |
| `receipt_items` | Snapshot taken when a shop sells to a customer |

Prices change over time. If profit were computed by joining transactions to the *current* `products.cost_price`, a supplier price increase today would silently rewrite the profit of every past sale. Snapshotting freezes both prices at transaction time — the same pattern the codebase already used for `price` in `order_items` (migration 00) and `receipt_items` (migration 02).

**Where the snapshots are taken:**

- `OrdersRepository.insertItems` — selects `price, cost_price` from `products` and writes both into `order_items`.
- `ReceiptsService.create` — the row-locking query `InventoryRepository.findByIdsForUpdate` joins `products` and carries `p.price, p.cost_price`; both are written into `receipt_items`.

Existing rows from before the migration have `cost_price = 0`, so historical profit equals full revenue until new transactions accumulate.

---

## The Profit Formula

One formula, applied over snapshot rows:

```
revenue = SUM(quantity × price)
cost    = SUM(quantity × cost_price)
profit  = SUM(quantity × (price − cost_price))  =  revenue − cost
```

Which rows get summed depends on **who is asking** (resolved in `AnalyticsService`):

| Caller | Data source | Meaning |
|--------|-------------|---------|
| `WAREHOUSE_ADMIN` (no `shopId`) | `order_items` of COMPLETED orders | **Warehouse profit** — what shops paid minus warehouse cost |
| `WAREHOUSE_ADMIN` + `?shopId=` | `receipt_items` of that shop | That shop's **sales profit** — customer sales minus cost |
| `SHOP_OWNER` | `receipt_items` of own shop (from JWT) | Own shop's sales profit |
| `EMPLOYEE` | — | `403` — profit is owner-level information |

**Time windows** reuse the `TrendPeriod` convention: `daily` (last 14 days), `weekly` (last 8 weeks), `monthly` (last 6 months). Order-based queries filter on `orders.updated_at` (when the order reached COMPLETED); receipt-based queries filter on `receipts.created_at`.

---

## GET /analytics/profit-summary

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `daily` | `daily` (14 days) · `weekly` (8 weeks) · `monthly` (6 months) |
| `shopId` | number | — | `WAREHOUSE_ADMIN` only — view a shop's sales profit instead of warehouse profit. Ignored for `SHOP_OWNER` |

**Response:**
```json
{ "revenue": 20352.27, "cost": 13143.75, "profit": 7208.52 }
```

All three are `float8` — plain numbers, no string parsing needed on the frontend.

**Edge cases:**
- Empty period → `{ "revenue": 0, "cost": 0, "profit": 0 }`, never `404`.
- `SHOP_OWNER` with no associated shop → `400 Bad Request`.
- `EMPLOYEE` → `403 Forbidden` (role guard).

---

## GET /analytics/profit-trend

Same params and scoping as `profit-summary`, bucketed by time for charts:

```json
[
  { "label": "2026-W21", "revenue": 1296.60, "cost": 835.00,  "profit": 461.60  },
  { "label": "2026-W25", "revenue": 2466.60, "cost": 1575.50, "profit": 891.10  },
  { "label": "2026-W26", "revenue": 6536.87, "cost": 4277.75, "profit": 2259.12 }
]
```

Label formats match `consumption-trend`: `daily` → `YYYY-MM-DD`, `weekly` → `IYYY-Www`, `monthly` → `YYYY-MM`. Sorted ascending; buckets with no transactions are omitted (no zero-padding).

---

## SQL — warehouse profit (order-based)

```sql
SELECT COALESCE(SUM(oi.quantity * oi.price), 0)::float8                   AS revenue,
       COALESCE(SUM(oi.quantity * oi.cost_price), 0)::float8              AS cost,
       COALESCE(SUM(oi.quantity * (oi.price - oi.cost_price)), 0)::float8 AS profit
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'COMPLETED'
  AND o.updated_at >= NOW() - INTERVAL '14 days';  -- or 8 weeks / 6 months
```

## SQL — shop profit (receipt-based)

```sql
SELECT COALESCE(SUM(ri.quantity * ri.price), 0)::float8                   AS revenue,
       COALESCE(SUM(ri.quantity * ri.cost_price), 0)::float8              AS cost,
       COALESCE(SUM(ri.quantity * (ri.price - ri.cost_price)), 0)::float8 AS profit
FROM receipt_items ri
JOIN receipts r ON r.id = ri.receipt_id
WHERE r.shop_id = $1
  AND r.created_at >= NOW() - INTERVAL '14 days';
```

The trend variants add a `TO_CHAR(...)` label expression and `GROUP BY label ORDER BY label ASC`. Both label and interval expressions come from a private `periodExprs(period, dateColumn)` helper in `AnalyticsRepository` — hardcoded per case, never derived from user input.

---

## cost_price Visibility Rule

`cost_price` reveals the owner's margin, so product responses filter it per role (`ProductsService.hideCostFromNonOwners`):

| Viewer | Own shop's product | Warehouse product | Another shop's product |
|--------|--------------------|-------------------|------------------------|
| `WAREHOUSE_ADMIN` | visible | visible | visible |
| `SHOP_OWNER` / `EMPLOYEE` | visible | `null` | n/a (not accessible) |

Applied on `GET /products` and `GET /products/:id`. The frontend should render the field only when non-null.

**Order and receipt responses are unchanged** — `cost_price` is stored on their item rows but deliberately not included in the JSON payloads, so a shop can never read the warehouse's cost off an order. Profit is only exposed through the two analytics endpoints above, which are already role-scoped.

---

## Product Create / Update

```json
POST /products
{
  "name": "Laptop 15\"",
  "price": 1200.00,
  "cost_price": 850.00,
  "category_id": 3
}
```

Validation: optional, `@IsNumber({ maxDecimalPlaces: 2 })`, `@Min(0)` (zero allowed — cost may be unknown; negative margins are legitimate, so there is no `cost_price <= price` check). Same field on `PATCH /products/:id`.

---

## Worked Example

A shop sells 10 water bottles and 2 phone cases in one receipt:

| item | qty | price snapshot | cost snapshot | revenue | cost | profit |
|------|-----|---------------|---------------|---------|------|--------|
| Water Bottle 500ml | 10 | 0.99 | 0.55 | 9.90 | 5.50 | 4.40 |
| Phone Case iPhone 15 | 2 | 12.99 | 7.50 | 25.98 | 15.00 | 10.98 |
| **total** | | | | **35.88** | **20.50** | **15.38** |

`GET /analytics/profit-summary` as that shop's owner returns exactly `{ "revenue": 35.88, "cost": 20.5, "profit": 15.38 }`.

---

## Known Limitation — shop margin on warehouse products

Shops resell warehouse products at the warehouse-set `price` (shops cannot edit warehouse products), and the receipt snapshot copies the *warehouse's* `cost_price`. A shop's reported "profit" on warehouse items therefore reflects the full margin over the warehouse's acquisition cost — not the margin over what the shop paid the warehouse. True per-shop margin would require per-shop pricing (a shop-specific selling price and/or using the order price as the shop's cost), which does not exist yet. For `LOCAL` products the shop sets both prices, so shop profit is exact.

---

## Module Layout

```
src/database/migrations/04-AddCostPrice.sql   ← schema change
src/products/                                  ← entity, DTOs, insert/update, visibility rule
src/orders/repositories/orders.repository.ts   ← cost snapshot on insertItems
src/receipts/services/receipts.service.ts      ← cost snapshot on receipt creation
src/inventory/repositories/inventory.repository.ts ← findByIdsForUpdate carries p.cost_price
src/analytics/                                 ← ProfitQueryDto, profit SQL, scoping, endpoints
src/database/seeders/seed.ts                   ← realistic cost prices + order_items backfill
```
