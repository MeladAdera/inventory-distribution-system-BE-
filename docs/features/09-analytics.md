# Analytics — Feature Documentation

## Overview

Two read-only aggregation endpoints that power the dashboard charts. Both run a single SQL query each — no N+1 requests. Access is JWT-protected; `WAREHOUSE_ADMIN` sees data across all shops, `SHOP_OWNER` and `EMPLOYEE` are automatically scoped to their own shop.

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/analytics/top-products` | JWT — All roles | Top consumed products by total quantity in COMPLETED orders |
| GET | `/analytics/consumption-trend` | JWT — All roles | Total units consumed over time, grouped by day / week / month |

---

## GET /analytics/top-products

**Query params:**

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `limit` | number | `5` | `20` | Number of products to return |

**Response:**
```json
[
  { "product_id": 5,  "product_name": "Water Bottle 500ml",  "total_quantity": 3620 },
  { "product_id": 9,  "product_name": "Chocolate Bar 100g",  "total_quantity": 750  },
  { "product_id": 8,  "product_name": "Potato Chips 150g",   "total_quantity": 540  }
]
```

**Definition of "consumed":** total units (`SUM(order_items.quantity)`) across orders with `status = 'COMPLETED'`. Counts units that left the warehouse and were received by shops.

**Scoping:**
- `WAREHOUSE_ADMIN` → aggregates across all shops
- `SHOP_OWNER` / `EMPLOYEE` → aggregates only orders received by their shop

---

## GET /analytics/consumption-trend

**Query params:**

| Param | Type | Default | Values | Description |
|-------|------|---------|--------|-------------|
| `period` | string | `daily` | `daily`, `weekly`, `monthly` | Time bucket size |

**Time window per period:**

| Period | Bucket | Window |
|--------|--------|--------|
| `daily` | Calendar day (`YYYY-MM-DD`) | Last 14 days |
| `weekly` | ISO week (`YYYY-Www`) | Last 8 weeks |
| `monthly` | Month (`YYYY-MM`) | Last 6 months |

**The date used is `orders.updated_at`** — the moment the order was marked COMPLETED, which is when units physically transferred. Using `created_at` (when the order was placed) would misrepresent when stock actually moved.

**Response:**
```json
[
  { "label": "2026-06-01", "value": 320 },
  { "label": "2026-06-02", "value": 280 },
  { "label": "2026-06-03", "value": 410 }
]
```

Days/weeks/months with zero consumption are not included (no zero-padding). The array is sorted ascending by label so it can be fed directly into any charting library.

**Scoping:** same as top-products — admin sees all shops, others see their own.

---

## SQL

### Top products
```sql
SELECT oi.product_id,
       p.name  AS product_name,
       SUM(oi.quantity)::int AS total_quantity
FROM order_items oi
JOIN orders   o ON o.id  = oi.order_id
JOIN products p ON p.id  = oi.product_id
WHERE o.status = 'COMPLETED'
  -- AND o.to_shop_id = $2  ← added when scoped to a shop
GROUP BY oi.product_id, p.name
ORDER BY total_quantity DESC
LIMIT $1;
```

### Consumption trend (daily example)
```sql
SELECT TO_CHAR(DATE(o.updated_at), 'YYYY-MM-DD') AS label,
       SUM(oi.quantity)::int AS value
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'COMPLETED'
  AND o.updated_at >= NOW() - INTERVAL '14 days'
  -- AND o.to_shop_id = $1  ← added when scoped to a shop
GROUP BY label
ORDER BY label ASC;
```

---

## Module Layout

```
src/analytics/
  analytics.module.ts
  controllers/analytics.controller.ts
  services/analytics.service.ts        ← scoping logic (admin vs shop)
  repositories/analytics.repository.ts ← SQL queries
  dto/analytics-query.dto.ts            ← TopProductsQueryDto, ConsumptionTrendQueryDto
```

---

## Access Control Summary

| Role | Scope |
|------|-------|
| `WAREHOUSE_ADMIN` | All shops combined |
| `SHOP_OWNER` | Own shop only (`to_shop_id = user.shopId`) |
| `EMPLOYEE` | Own shop only (`to_shop_id = user.shopId`) |
