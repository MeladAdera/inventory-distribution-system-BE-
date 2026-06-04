# How to Test: Categories

## Prerequisites

1. Docker running: `docker compose up -d`
2. App running: `npm run start:dev` — migrations 07 and 08 apply automatically
3. Verify admin `shopId` is now `1` after logging in (Step 1)

---

## Step 1 — Login as admin, verify shopId = 1

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@warehouse.com","password":"Admin@123"}'
```

Expected: `data.user.shopId` is `1` (was `null` before migration 08).

```bash
ADMIN_TOKEN="paste-token-here"
```

---

## Step 2 — Create warehouse (global) categories — no ?shopId needed

```bash
curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Beverages"}'

curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Dairy"}'

curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Snacks"}'
```

Expected: all 3 created with `shop_id: 1` (warehouse).

---

## Step 3 — Duplicate name rejected (case-insensitive)

```bash
curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"beverages"}'
```

Expected: `409 A category with this name already exists in this shop`

---

## Step 4 — Name too short rejected

```bash
curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"AB"}'
```

Expected: `400` validation error

---

## Step 5 — Create a shop + owner

```bash
curl -X POST http://localhost:3000/users/shop-owners \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "shopName": "MD Market",
    "ownerName": "Yazan Ali",
    "email": "yazan@mdmarket.com",
    "password": "Pass@1234",
    "shopAddress": "Amman, Jordan"
  }'
```

Note the `shop_id` (e.g. `2`).

---

## Step 6 — Login as shop owner

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"yazan@mdmarket.com","password":"Pass@1234"}'
```

```bash
OWNER_TOKEN="paste-token-here"
SHOP_ID=2
```

---

## Step 7 — Shop owner creates their own local category

```bash
curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"name":"Imported Goods"}'
```

Expected: created with `shop_id: 2`.

---

## Step 8 — KEY TEST: shop owner sees own + warehouse categories

```bash
curl http://localhost:3000/categories \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: **4 categories** — Beverages, Dairy, Snacks (warehouse) + Imported Goods (own):

```json
{
  "data": [
    { "id": 1, "shop_id": 1, "name": "Beverages" },
    { "id": 2, "shop_id": 1, "name": "Dairy" },
    { "id": 3, "shop_id": 1, "name": "Snacks" },
    { "id": 4, "shop_id": 2, "name": "Imported Goods" }
  ]
}
```

---

## Step 9 — Admin lists all categories (no filter)

```bash
curl http://localhost:3000/categories \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: all 4 categories across all shops.

---

## Step 10 — Admin filters by shop

```bash
# Only warehouse categories
curl "http://localhost:3000/categories?shopId=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Only MD Market categories
curl "http://localhost:3000/categories?shopId=$SHOP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Step 11 — Admin creates a category in a specific shop

```bash
curl -X POST "http://localhost:3000/categories?shopId=$SHOP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Local Produce"}'
```

Expected: `shop_id: 2`

---

## Step 12 — Get category by ID

```bash
curl http://localhost:3000/categories/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

```bash
# 404
curl http://localhost:3000/categories/9999 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Step 13 — Owner cannot access another shop's category

```bash
# Category id=1 belongs to warehouse (shop_id=1), not MD Market
curl http://localhost:3000/categories/1 \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: `403 You can only manage categories for your own shop`

---

## Step 14 — Update a category

```bash
curl -X PATCH "http://localhost:3000/categories/4" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"name":"Imported & Organic"}'
```

Expected: updated category returned.

---

## Step 15 — Delete a category (no products)

```bash
curl -X DELETE "http://localhost:3000/categories/4" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: `204 No Content` — empty body.

---

## Step 16 — Employee is read-only

```bash
# Create employee
curl -X POST http://localhost:3000/users/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"name":"Sami","email":"sami@mdmarket.com","password":"Pass@1234"}'

# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sami@mdmarket.com","password":"Pass@1234"}'
```

```bash
EMP_TOKEN="paste-token-here"

# Read → allowed
curl http://localhost:3000/categories -H "Authorization: Bearer $EMP_TOKEN"

# Write → 403
curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EMP_TOKEN" \
  -d '{"name":"Test"}'
```
