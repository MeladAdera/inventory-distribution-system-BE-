# How to Test: Analytics

## Prerequisites

1. Docker running: `docker compose up -d`
2. Migrations applied: `npm run migration:run`
3. Seed data loaded: `npm run seed`
4. App running: `npm run start:dev`

> The seed populates 19 COMPLETED orders spread across the last 5 months, giving both charts meaningful data.

---

## Step 1 — Login

```bash
# Admin (sees all shops)
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@warehouse.com","password":"Admin@123"}'

ADMIN_TOKEN="paste-token-here"

# Shop owner (sees Downtown only)
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@downtown.com","password":"Owner@123"}'

ALICE_TOKEN="paste-token-here"
```

---

## Step 2 — Top products (admin, default limit 5)

```bash
curl http://localhost:3001/analytics/top-products \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** array of 5 products sorted by `total_quantity` descending. Water Bottle 500ml should rank first (highest volume in seed data).

---

## Step 3 — Top products with custom limit

```bash
curl "http://localhost:3001/analytics/top-products?limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** up to 10 products. Limit of 20 is the max — sending `?limit=21` returns 400.

---

## Step 4 — Top products scoped to a shop

```bash
curl http://localhost:3001/analytics/top-products \
  -H "Authorization: Bearer $ALICE_TOKEN"
```

**Expected:** same product names but lower `total_quantity` values than the admin view — Alice only sees Downtown Shop's completed orders.

---

## Step 5 — Consumption trend: daily

```bash
curl "http://localhost:3001/analytics/consumption-trend?period=daily" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** ~13–14 data points with labels like `"2026-06-02"`, `"2026-06-03"`, …, sorted ascending. Each `value` is total units across all shops that day.

---

## Step 6 — Consumption trend: weekly

```bash
curl "http://localhost:3001/analytics/consumption-trend?period=weekly" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** up to 8 data points with labels like `"2026-W23"` (ISO week format). Current week and up to 7 prior weeks.

---

## Step 7 — Consumption trend: monthly

```bash
curl "http://localhost:3001/analytics/consumption-trend?period=monthly" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** 6 data points with labels `"2026-01"` through `"2026-06"`. Current month (June) will have the highest value because it includes all 14 daily-trend orders.

---

## Step 8 — Requires auth

```bash
curl http://localhost:3001/analytics/top-products
```

**Expected:** `401 Unauthorized` — no token, no data.

---

## Step 9 — Invalid period rejected

```bash
curl "http://localhost:3001/analytics/consumption-trend?period=yearly" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** `400 Bad Request` — `period` must be one of `daily`, `weekly`, `monthly`.

---

## What the numbers mean

The seed contains 19 COMPLETED orders across 5 months:
- 5 older orders (months -5 through -6 weeks ago) for monthly coverage
- 14 daily orders (one per day for the last 14 days) for daily/weekly coverage

In-flight orders (`SHIPPED`, `PROCESSING`, `PENDING`) are **not** counted — they have not been received yet.
