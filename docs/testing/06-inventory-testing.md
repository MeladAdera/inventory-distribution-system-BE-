# How to Test: Inventory

## Prerequisites

1. Docker running: `docker compose up -d`
2. Migrations applied: `npm run migration:run` (migration 10 must be in the output)
3. App running: `npm run start:dev`
4. At least one product exists — run through `05-products-testing.md` first to have product IDs ready

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

## Step 2 — Stock In (creates inventory record)

Use a real `productId` from your products table.

```bash
curl -X POST http://localhost:3000/inventory/stock-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"productId": 1, "quantity": 100, "notes": "Initial warehouse stock"}'
```

Expected: inventory record with `current_quantity: 100`, `low_stock_threshold: 10`, `is_low_stock: false`.

---

## Step 3 — Stock In again (upsert — adds to existing)

```bash
curl -X POST http://localhost:3000/inventory/stock-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"productId": 1, "quantity": 50}'
```

Expected: same inventory record, `current_quantity: 150`. The record was not duplicated — quantity was summed.

---

## Step 4 — Stock In a second product (low-stock scenario)

```bash
curl -X POST http://localhost:3000/inventory/stock-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"productId": 2, "quantity": 3, "notes": "Small delivery"}'
```

Expected: `current_quantity: 3` — below the default threshold of `10`, so `is_low_stock: true`.

---

## Step 5 — List inventory

```bash
curl "http://localhost:3000/inventory" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: paginated list with `data`, `total`, `page`, `totalPages`.

---

## Step 6 — Filter: low-stock only

```bash
curl "http://localhost:3000/inventory?lowStock=true" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: only the record with `current_quantity: 3` (product 2).

---

## Step 7 — Filter: by product

```bash
curl "http://localhost:3000/inventory?productId=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: single record for product 1 only.

---

## Step 8 — Get single record

```bash
# Use the id returned from step 2
curl http://localhost:3000/inventory/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: single object with `product_name` and `is_low_stock`.

```bash
# Non-existent record
curl http://localhost:3000/inventory/9999 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `404 Inventory record not found`

---

## Step 9 — Low-stock endpoint

```bash
curl http://localhost:3000/inventory/low-stock \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: array (not paginated) containing the product-2 record (`current_quantity: 3`). Product 1 is not here because `150 > 10`.

---

## Step 10 — Adjust: reduce quantity (happy path)

```bash
curl -X PATCH http://localhost:3000/inventory/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"adjustment": -10, "reason": "Damaged items"}'
```

Expected: `current_quantity` drops from `150` to `140`.

---

## Step 11 — Adjust: add quantity

```bash
curl -X PATCH http://localhost:3000/inventory/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"adjustment": 5}'
```

Expected: `current_quantity` goes from `140` to `145`.

---

## Step 12 — Adjust: negative stock blocked

```bash
curl -X PATCH http://localhost:3000/inventory/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"adjustment": -99999}'
```

Expected: `400 Bad Request` — message explains current quantity and the attempted adjustment.

---

## Step 13 — Adjust: zero rejected by validation

```bash
curl -X PATCH http://localhost:3000/inventory/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"adjustment": 0}'
```

Expected: `400 Bad Request` — class-validator rejects zero before the service is called.

---

## Step 14 — Stock In: missing required fields

```bash
curl -X POST http://localhost:3000/inventory/stock-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"quantity": 50}'
```

Expected: `400` — `productId` is required.

---

## Step 15 — Verify audit logs in the database

Every mutation above created a row in `audit_logs`. Check directly:

```bash
psql -U postgres -d inventory_db_dev \
  -c "SELECT id, action, entity_id, quantity, notes, created_at FROM audit_logs WHERE type = 'INVENTORY' ORDER BY id DESC LIMIT 10;"
```

Expected:
- `STOCK_IN` rows for steps 2, 3, 4
- `ADJUSTMENT` rows for steps 10, 11

---

## Step 16 — Authorization: Employee is read-only

Create an employee and login:

```bash
# Create employee (as shop owner)
curl -X POST http://localhost:3000/users/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"name":"Test Employee","email":"emp@test.com","password":"Pass@1234"}'

# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"emp@test.com","password":"Pass@1234"}'
```

```bash
EMP_TOKEN="paste-token-here"
```

```bash
# Read — should work
curl http://localhost:3000/inventory \
  -H "Authorization: Bearer $EMP_TOKEN"

# Stock in — should be blocked
curl -X POST http://localhost:3000/inventory/stock-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EMP_TOKEN" \
  -d '{"productId": 1, "quantity": 10}'

# Adjust — should be blocked
curl -X PATCH http://localhost:3000/inventory/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EMP_TOKEN" \
  -d '{"adjustment": 5}'
```

Expected: `GET` → `200`, `POST` and `PATCH` → `403 Forbidden`.

---

## Step 17 — Authorization: Shop owner cannot touch another shop's inventory

Login as a shop owner:

```bash
OWNER_TOKEN="paste-token-here"
```

```bash
# Try to adjust warehouse inventory (shop_id = 1, owned by admin)
curl -X PATCH http://localhost:3000/inventory/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"adjustment": -5}'
```

Expected: `403 You can only modify inventory for your own shop`

---

## Step 18 — Shop owner sees only their own shop

```bash
curl http://localhost:3000/inventory \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: only inventory records where `shop_id` matches the owner's shop. Warehouse inventory is not visible.

---

## Summary: What to verify

| Scenario | Expected |
|---|---|
| Stock in — new product | Creates record, `current_quantity = quantity` |
| Stock in — existing product | Adds to existing, no duplicate record |
| Stock in — employee | `403` |
| List inventory — admin | All shops |
| List inventory — owner/employee | Own shop only |
| `?lowStock=true` filter | Only items below threshold |
| `?productId=X` filter | Only that product |
| `/low-stock` endpoint | Unpaginated alert list |
| Adjust — valid | Quantity updated, audit log created |
| Adjust — goes negative | `400` before transaction |
| Adjust — zero | `400` from validation |
| Adjust — other shop (owner) | `403` |
| Audit logs | One row per stock-in, one row per adjustment |
