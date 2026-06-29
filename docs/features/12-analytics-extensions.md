# Analytics Extensions — Feature Documentation

## Overview

Two additional analytics endpoints added on top of the original `top-products` and `consumption-trend` endpoints. Both are read-only and JWT-protected.

| Endpoint | Data source | Question it answers |
|----------|-------------|---------------------|
| `GET /analytics/products-by-shop` | `order_items` (COMPLETED orders) | Which products are received the most, and which shops drive that? |
| `GET /analytics/shop-consumption` | `receipt_items` (receipts) | What did a specific shop actually consume, and how much of each product? |

The distinction between data sources is intentional:
- **Orders** measure what shops *received* from the warehouse (inbound stock).
- **Receipts** measure what shops *used* (outbound — inventory decreases recorded by shop staff).

---

## Endpoints

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/analytics/products-by-shop` | JWT | `WAREHOUSE_ADMIN` only | Top N products with per-shop consumption breakdown |
| GET | `/analytics/shop-consumption` | JWT | All roles | Paginated per-product consumption for a shop, from receipts |

---

## GET /analytics/products-by-shop

**Query params:**

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `period` | string | `daily` | — | `daily` (14 days) · `weekly` (8 weeks) · `monthly` (6 months) |
| `limit` | number | `10` | `50` | Max products to return, sorted by total consumption descending |
| `shopId` | number | — | — | Filter to a single shop. Omit to see all shops grouped together |

**Time window:** uses `orders.updated_at` — the moment the order reached `COMPLETED` status. Same logic as `consumption-trend`.

**Scoping:** `WAREHOUSE_ADMIN` only. No automatic shop-scoping — the optional `shopId` param is the filter mechanism.

**Response — no `shopId` (all shops):**
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

**Response — with `shopId`:**

Same structure, but `total_quantity` reflects only that shop's consumption and `shops` contains only the one requested shop.

**Sorting:**
- Top-level array: by `total_quantity` descending
- `shops` array within each product: by `quantity` descending

**Edge cases:**
- Products with zero consumption in the period are excluded.
- Non-existent `shopId` returns an empty array (not `404`).
- Response is not paginated — capped by `limit`.

---

## SQL — products-by-shop

Uses a two-step CTE. The first CTE aggregates by product + shop; the second picks the top-N products by total quantity; the final SELECT joins them to produce flat rows that are grouped into the nested shape in the service layer.

```sql
WITH product_shop AS (
  SELECT oi.product_id,
         p.name               AS product_name,
         o.to_shop_id         AS shop_id,
         s.name               AS shop_name,
         SUM(oi.quantity)::int AS shop_quantity
  FROM order_items oi
  JOIN orders   o ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id
  JOIN shops    s ON s.id = o.to_shop_id
  WHERE o.status = 'COMPLETED'
    AND o.updated_at >= NOW() - INTERVAL '14 days'  -- or 8 weeks / 6 months
    -- AND o.to_shop_id = $2  ← added when shopId is provided
  GROUP BY oi.product_id, p.name, o.to_shop_id, s.name
),
product_totals AS (
  SELECT product_id,
         product_name,
         SUM(shop_quantity)::int AS total_quantity
  FROM product_shop
  GROUP BY product_id, product_name
  ORDER BY total_quantity DESC
  LIMIT $1
)
SELECT pt.product_id,
       pt.product_name,
       pt.total_quantity,
       ps.shop_id,
       ps.shop_name,
       ps.shop_quantity
FROM product_totals pt
JOIN product_shop ps ON ps.product_id = pt.product_id
ORDER BY pt.total_quantity DESC, ps.shop_quantity DESC;
```

**Why a CTE instead of a subquery?** The `LIMIT` on the top-N products must run before joining back to shop details, otherwise the limit would apply to the flat rows (product × shop combinations) rather than to distinct products.

**Flat → nested transformation** happens in `AnalyticsService.getProductsByShop` using a `Map<product_id, ProductByShopRow>` — simple iteration, no extra DB round-trip.

---

## GET /analytics/shop-consumption

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `daily` | `daily` (14 days) · `weekly` (8 weeks) · `monthly` (6 months) |
| `shopId` | number | — | **Required for `WAREHOUSE_ADMIN`** — which shop to inspect. Ignored for `SHOP_OWNER` / `EMPLOYEE` (pulled from JWT) |
| `page` | number | `1` | Page number |
| `limit` | number | `10` | Products per page |

**Time window:** uses `receipts.created_at` — when the receipt was created (the moment staff recorded the consumption).

**Scoping:**
- `WAREHOUSE_ADMIN` → `shopId` is required; returns `400` if omitted.
- `SHOP_OWNER` / `EMPLOYEE` → `shopId` is ignored; always scoped to `user.shopId` from the JWT.

**Response:**
```json
{
  "data": [
    { "product_id": 11, "product_name": "Egyptian Rice", "quantity": 8 },
    { "product_id": 5,  "product_name": "Tuna Leo",      "quantity": 5 },
    { "product_id": 22, "product_name": "Orange Juice",  "quantity": 3 }
  ],
  "page": 1,
  "limit": 10,
  "total": 8,
  "totalPages": 1,
  "hasNext": false,
  "hasPrev": false
}
```

**Sorting:** by `quantity` descending, consistent across all pages.

**Edge cases:**
- Products with zero consumption in the period are excluded.
- Non-existent `shopId` returns `data: []` with `total: 0` (not `404`).
- `WAREHOUSE_ADMIN` without `shopId` → `400 Bad Request`.

**Error:**
```json
{ "message": "shopId is required for WAREHOUSE_ADMIN" }
```

---

## SQL — shop-consumption

Single aggregation query with `COUNT(*) OVER()` to compute the total count in one round-trip, plus `LIMIT`/`OFFSET` for pagination.

```sql
SELECT ri.product_id,
       p.name               AS product_name,
       SUM(ri.quantity)::int AS quantity,
       COUNT(*) OVER()       AS total_count   -- total distinct products across all pages
FROM receipt_items ri
JOIN receipts r ON r.id = ri.receipt_id
JOIN products p ON p.id = ri.product_id
WHERE r.shop_id    = $1
  AND r.created_at >= NOW() - INTERVAL '14 days'  -- or 8 weeks / 6 months
GROUP BY ri.product_id, p.name
ORDER BY quantity DESC
LIMIT $2 OFFSET $3;
```

**Why `COUNT(*) OVER()`?** A window function runs over the full result set before `LIMIT`/`OFFSET` are applied, giving the true total without needing a second `COUNT(*)` query. The `total_count` column is stripped from each row in the repository before returning `PaginatedShopConsumption`.

---

## Module Layout

```
src/analytics/
  analytics.module.ts
  controllers/analytics.controller.ts
  services/analytics.service.ts        ← scoping + paginate() wrapping
  repositories/analytics.repository.ts ← SQL queries + PaginatedShopConsumption
  dto/analytics-query.dto.ts            ← ProductsByShopQueryDto, ShopConsumptionQueryDto
```

---

## Access Control Summary

| Endpoint | Role | Scope |
|----------|------|-------|
| `products-by-shop` | `WAREHOUSE_ADMIN` | All shops, or filtered by `?shopId` |
| `shop-consumption` | `WAREHOUSE_ADMIN` | Shop specified by required `?shopId` |
| `shop-consumption` | `SHOP_OWNER` | Own shop (from JWT) |
| `shop-consumption` | `EMPLOYEE` | Own shop (from JWT) |
