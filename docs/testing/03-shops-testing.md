# How to Test: Shops

## Prerequisites

1. Docker running: `docker compose up -d`
2. App running: `npm run start:dev` (migration `06-AddShopIsActive.sql` applies automatically)
3. Admin token from Step 1 below

---

## Step 1 — Login as Warehouse Admin

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@warehouse.com","password":"Admin@123"}'
```

Save the token:
```bash
ADMIN_TOKEN="paste-your-token-here"
```

---

## Step 2 — List All Shops (admin sees all)

```bash
curl http://localhost:3000/shops \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: array containing at least the seeded `Main Warehouse`.

---

## Step 3 — Create a Shop + Owner (needed for multi-role tests)

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

Note the `shop_id` in the response — you'll need it below.

---

## Step 4 — Login as Shop Owner

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"yazan@mdmarket.com","password":"Pass@1234"}'
```

```bash
OWNER_TOKEN="paste-owner-token-here"
SHOP_ID=2   # replace with the actual shop id from Step 3
```

---

## Step 5 — Shop Owner sees only their shop

```bash
curl http://localhost:3000/shops \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: single object (not an array), showing only MD Market.

---

## Step 6 — Get Shop by ID

```bash
# Admin — can access any shop
curl http://localhost:3000/shops/$SHOP_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Owner — can access own shop
curl http://localhost:3000/shops/$SHOP_ID \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: shop object with `200`.

---

## Step 7 — 404 for non-existent shop

```bash
curl http://localhost:3000/shops/9999 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `statusCode: 404, message: "Shop not found"`

---

## Step 8 — 403 when owner accesses another shop

```bash
# Shop id 1 is the warehouse — not owned by Yazan
curl http://localhost:3000/shops/1 \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: `statusCode: 403, message: "You can only view your own shop"`

---

## Step 9 — Update Shop Info

```bash
curl -X PATCH http://localhost:3000/shops/$SHOP_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"MD Market Updated","phone":"0501234567"}'
```

Expected: updated shop object. Only `name` and `phone` change — `address` stays the same.

---

## Step 10 — Employee cannot update shops

```bash
# First create an employee
curl -X POST http://localhost:3000/users/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"name":"Sami","email":"sami@mdmarket.com","password":"Pass@1234"}'

# Login as employee
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sami@mdmarket.com","password":"Pass@1234"}'
```

```bash
EMP_TOKEN="paste-employee-token-here"

curl -X PATCH http://localhost:3000/shops/$SHOP_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EMP_TOKEN" \
  -d '{"name":"hacked"}'
```

Expected: `statusCode: 403`

---

## Step 11 — Deactivate a Shop

```bash
curl -X PATCH http://localhost:3000/shops/$SHOP_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"isActive":false}'
```

Expected: shop returned with `is_active: false`.

---

## Step 12 — Deactivated shop owner cannot login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"yazan@mdmarket.com","password":"Pass@1234"}'
```

Expected: `statusCode: 401, message: "Your shop has been deactivated"`

---

## Step 13 — Cannot deactivate the Warehouse

```bash
# Shop id 1 is the WAREHOUSE type
curl -X PATCH http://localhost:3000/shops/1/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"isActive":false}'
```

Expected: `statusCode: 400, message: "The warehouse shop cannot be deactivated"`

---

## Step 14 — Reactivate the shop

```bash
curl -X PATCH http://localhost:3000/shops/$SHOP_ID/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"isActive":true}'
```

Expected: shop returned with `is_active: true`. Owner can now login again.

---

## Step 15 — Swagger UI (optional)

Open `http://localhost:3000/api`, authorize with the admin token, and try all `/shops` endpoints from the UI.
