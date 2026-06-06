# How to Test: Orders

## Prerequisites

1. Docker running: `docker compose up -d`
2. Migrations applied: `npm run migration:run`
3. App running: `npm run start:dev`
4. Complete `06-inventory-testing.md` first — warehouse inventory must have stock before orders can be created

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

## Step 2 — Create a shop and shop owner (if not done already)

```bash
# Create a shop
curl -X POST http://localhost:3000/shops \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Test Shop","address":"123 Main St","phone":"0501234567"}'

# Create a shop owner for that shop (use the shopId from above)
curl -X POST http://localhost:3000/users/shop-owners \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"Shop Owner","email":"owner@testshop.com","password":"Owner@1234","shopId":2}'

# Login as shop owner
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@testshop.com","password":"Owner@1234"}'
```

```bash
OWNER_TOKEN="paste-token-here"
```

---

## Step 3 — Seed warehouse inventory

The warehouse must have stock before a shop can order it.

```bash
curl -X POST http://localhost:3000/inventory/stock-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"productId": 1, "quantity": 500}'

curl -X POST http://localhost:3000/inventory/stock-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"productId": 2, "quantity": 200}'
```

---

## Step 4 — Create an order (as shop owner)

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{
    "items": [
      { "productId": 1, "quantity": 50 },
      { "productId": 2, "quantity": 10 }
    ]
  }'
```

Expected: `201`, order object with `status: "PENDING"`. Save the `id` (e.g. `ORDER_ID=1`).

---

## Step 5 — List orders

```bash
# Admin sees all orders
curl "http://localhost:3000/orders" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Shop owner sees only their shop's orders
curl "http://localhost:3000/orders" \
  -H "Authorization: Bearer $OWNER_TOKEN"

# Filter by status
curl "http://localhost:3000/orders?status=PENDING" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Step 6 — Get single order with items

```bash
curl http://localhost:3000/orders/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: order object with `items` array showing `product_name`, `quantity`, and `price` for each line.

---

## Step 7 — Advance through the full lifecycle

### PENDING → PROCESSING

```bash
curl -X PATCH http://localhost:3000/orders/1/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"status": "PROCESSING"}'
```

Expected: `200`, order with `status: "PROCESSING"`.

### PROCESSING → SHIPPED

```bash
curl -X PATCH http://localhost:3000/orders/1/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"status": "SHIPPED"}'
```

Expected: `200`, order with `status: "SHIPPED"`. **Inventory unchanged at this point.**

### SHIPPED → RECEIVED (inventory transfer happens here)

```bash
curl -X PATCH http://localhost:3000/orders/1/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"status": "RECEIVED"}'
```

Expected: `200`, order with `status: "RECEIVED"`.

**Verify inventory moved:**

```bash
# Warehouse inventory should have decreased
curl "http://localhost:3000/inventory?productId=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Shop inventory should have increased (or been created)
curl "http://localhost:3000/inventory" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

### RECEIVED → COMPLETED

```bash
curl -X PATCH http://localhost:3000/orders/1/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"status": "COMPLETED"}'
```

---

## Step 8 — Verify audit logs

After RECEIVED, three audit rows should exist for each order item:

```bash
psql -U postgres -d inventory_db_dev \
  -c "SELECT type, action, entity_type, entity_id, quantity, notes FROM audit_logs ORDER BY id DESC LIMIT 10;"
```

Expected rows:
- `INVENTORY / TRANSFER_OUT` — warehouse inventory record, negative quantity
- `INVENTORY / TRANSFER_IN` — shop inventory record, positive quantity
- `ORDER / STATUS_CHANGED` — notes = `"SHIPPED → RECEIVED"`

---

## Step 9 — Invalid status transition

```bash
# Try to skip PROCESSING and go straight to SHIPPED from a new PENDING order
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"items": [{"productId": 1, "quantity": 5}]}'

# Now try PENDING → SHIPPED (invalid)
curl -X PATCH http://localhost:3000/orders/2/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"status": "SHIPPED"}'
```

Expected: `400 Bad Request` — message explains current status is `PENDING` and expected next is `PROCESSING`.

---

## Step 10 — Authorization: shop owner cannot update status

```bash
curl -X PATCH http://localhost:3000/orders/1/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"status": "PROCESSING"}'
```

Expected: `403 Forbidden`.

---

## Step 11 — Authorization: shop owner cannot see another shop's order

```bash
# Create a second shop and owner
SECOND_OWNER_TOKEN="paste-second-owner-token"

# Try to fetch an order that belongs to shop 2 using shop 3's token
curl http://localhost:3000/orders/1 \
  -H "Authorization: Bearer $SECOND_OWNER_TOKEN"
```

Expected: `403 Forbidden`.

---

## Step 12 — Validation: duplicate products rejected

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{
    "items": [
      { "productId": 1, "quantity": 10 },
      { "productId": 1, "quantity": 5 }
    ]
  }'
```

Expected: `400 Duplicate products in order`.

---

## Step 13 — Validation: product not in warehouse inventory

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{
    "items": [
      { "productId": 9999, "quantity": 1 }
    ]
  }'
```

Expected: `400 Product 9999 does not exist in warehouse inventory`.

---

## Step 14 — RECEIVED blocked if warehouse stock insufficient

Create an order for more than what the warehouse holds, then advance to RECEIVED.

```bash
# Warehouse has 450 of product 1 left (500 - 50 from step 4)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"items": [{"productId": 1, "quantity": 999}]}'

# Advance to RECEIVED
# (advance through PROCESSING and SHIPPED first, then RECEIVED)
# On RECEIVED:
```

Expected: `400 Insufficient warehouse stock for product 1 (available: 450, required: 999)`. Inventory unchanged.

---

## Step 15 — Admin cannot create an order

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"items": [{"productId": 1, "quantity": 10}]}'
```

Expected: `403 Forbidden` — only `SHOP_OWNER` can create orders.

---

## Summary: What to verify

| Scenario | Expected |
|---|---|
| Create order — shop owner | `201`, status `PENDING` |
| Create order — admin | `403` |
| Create order — duplicate products | `400` |
| Create order — product not in warehouse | `400` |
| List orders — admin | All orders |
| List orders — shop owner/employee | Own shop only |
| `?status=` filter | Only matching orders |
| Get order by id — with items | `items[]` array with `product_name` |
| Get other shop's order (non-admin) | `403` |
| PENDING → PROCESSING | `200` |
| PENDING → SHIPPED (skip) | `400 Invalid transition` |
| SHIPPED → RECEIVED | `200`, inventory transferred |
| Warehouse stock after RECEIVED | Decreased |
| Shop inventory after RECEIVED | Increased / created |
| Status update — shop owner | `403` |
| RECEIVED with insufficient stock | `400`, full rollback |
| Audit logs after RECEIVED | TRANSFER_OUT + TRANSFER_IN + STATUS_CHANGED |
