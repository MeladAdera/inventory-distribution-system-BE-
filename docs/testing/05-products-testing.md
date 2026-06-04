# How to Test: Products

## Prerequisites

1. Docker running: `docker compose up -d`
2. App running: `npm run start:dev` — migration 09 applies automatically
3. At least one category exists in the warehouse (run through `04-categories-testing.md` first)

---

## Step 1 — Login as admin

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@warehouse.com","password":"Admin@123"}'
```

```bash
ADMIN_TOKEN="paste-token-here"
```

---

## Step 2 — Create warehouse products (no ?shop_id needed)

```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Mineral Water 500ml","price":0.5,"category_id":1,"barcode":"6281234567890"}'

curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Orange Juice 1L","price":1.2,"category_id":1}'

curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Full Cream Milk 1L","price":0.9,"category_id":2}'
```

Expected: all created with `source: "WAREHOUSE"`, `is_global: true`, `shop_id: 1`.

---

## Step 3 — source cannot be set manually

```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Test","price":1,"category_id":1,"source":"LOCAL"}'
```

Expected: `400` — `source` is not a whitelisted field.

---

## Step 4 — Duplicate barcode rejected

```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Another Water","price":0.6,"category_id":1,"barcode":"6281234567890"}'
```

Expected: `409 A product with this barcode already exists in this shop`

---

## Step 5 — Validation errors

```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"AB","price":-5,"category_id":1}'
```

Expected: `400` — name too short + price must be positive.

---

## Step 6 — Create shop + owner + local category

```bash
# Create shop owner
curl -X POST http://localhost:3000/users/shop-owners \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"shopName":"MD Market","ownerName":"Yazan","email":"yazan@mdmarket.com","password":"Pass@1234","shopAddress":"Amman"}'

# Login as owner
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"yazan@mdmarket.com","password":"Pass@1234"}'
```

```bash
OWNER_TOKEN="paste-token-here"
SHOP_ID=2
```

```bash
# Create a local category for MD Market
curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"name":"Local Goods"}'
```

Note the category id (e.g. `4`).

---

## Step 7 — Shop owner creates a local product

```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"name":"Local Dates 500g","price":3.5,"category_id":4}'
```

Expected: `source: "LOCAL"`, `shop_id: 2`.

---

## Step 8 — Shop owner can use a warehouse category

```bash
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"name":"Local Juice","price":2.0,"category_id":1}'
```

Expected: `201` — category 1 is a warehouse (global) category, accessible to all shops.

---

## Step 9 — KEY TEST: shop owner lists products — sees own + warehouse

```bash
curl "http://localhost:3000/products" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: paginated response with both `source: "WAREHOUSE"` and `source: "LOCAL"` products.

---

## Step 10 — Filter by source

```bash
# Warehouse products only
curl "http://localhost:3000/products?source=WAREHOUSE" \
  -H "Authorization: Bearer $OWNER_TOKEN"

# Local products only (own shop)
curl "http://localhost:3000/products?source=LOCAL" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

---

## Step 11 — Filter by category

```bash
curl "http://localhost:3000/products?category_id=1" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: only products in category 1 (Beverages) accessible to MD Market.

---

## Step 12 — Pagination

```bash
curl "http://localhost:3000/products?page=1&limit=2" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: 2 products, `total` shows full count, `hasNext: true` if more exist.

```bash
curl "http://localhost:3000/products?page=2&limit=2" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: next 2 products, `hasPrev: true`.

---

## Step 13 — Admin filters by shop

```bash
# Only MD Market products
curl "http://localhost:3000/products?shop_id=$SHOP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Only warehouse products
curl "http://localhost:3000/products?shop_id=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Step 14 — Admin creates product in a specific shop

```bash
curl -X POST "http://localhost:3000/products?shop_id=$SHOP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Imported Chips","price":1.8,"category_id":4}'
```

Expected: `source: "LOCAL"`, `shop_id: 2`.

---

## Step 15 — Get product by ID

```bash
# Exists
curl http://localhost:3000/products/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Not found
curl http://localhost:3000/products/9999 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `200` then `404`.

---

## Step 16 — Owner cannot access another shop's local product

```bash
# Get a LOCAL product belonging to a different shop (create one via admin first)
curl http://localhost:3000/products/<other-shop-product-id> \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: `403 You do not have access to this product`

---

## Step 17 — Update a product

```bash
curl -X PATCH http://localhost:3000/products/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"price":0.75,"name":"Mineral Water 500ml Premium"}'
```

Expected: updated product returned. Only sent fields change.

---

## Step 18 — Soft delete

```bash
curl -X DELETE http://localhost:3000/products/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `204 No Content`.

```bash
# Now try to GET it
curl http://localhost:3000/products/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `404` — hidden from all queries, but inventory and order records still exist in the DB.

---

## Step 19 — Employee is read-only

```bash
# Create employee, login, get EMP_TOKEN
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EMP_TOKEN" \
  -d '{"name":"Test","price":1,"category_id":1}'
```

Expected: `403`

---

## Step 20 — Combined filters

```bash
curl "http://localhost:3000/products?source=WAREHOUSE&category_id=1&page=1&limit=5" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: paginated warehouse products in category 1 (Beverages) only.
