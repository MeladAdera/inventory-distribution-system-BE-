# How to Test: Suppliers (and the shared Debts endpoints)

## Using this guide in Apidog

Every step below is written as a `curl` command. You do not need to type it
into Apidog by hand — Apidog can read it directly:

1. Click **Import** (top left, or `+` → Import).
2. Choose **cURL**.
3. Paste the whole `curl ...` block for that step.
4. Apidog fills in the method, URL, headers, and body for you.

Two things worth setting up first, so you are not pasting the token into
every request by hand:

- Create an Apidog **Environment** (e.g. "Local") with a variable `baseUrl`
  = `http://localhost:3001`.
- After you log in (Step 1), copy the `accessToken` from the response into
  another variable, e.g. `token`, then use `Bearer {{token}}` as the
  Authorization header on every later request. Apidog can also do this
  automatically with a "post-response script" if you want it fully
  hands-off, but manually pasting it once per test session is fine too.

---

## Prerequisites

1. Docker running: `docker compose up -d`
2. Migrations applied: `npm run migration:run` (should say "No pending
   migrations" if you already ran it)
3. App running: `npm run start:dev`
4. Base URL: `http://localhost:3001`

### Accounts you'll need

| Role | Account |
|---|---|
| WAREHOUSE_ADMIN | `admin@warehouse.com` / `Admin@123` — this one is seeded and always works |
| SHOP_OWNER (shop 2) | Use your own real account, **or** create a throwaway one (see below) |
| EMPLOYEE (shop 2) | Same — your own, or a throwaway one |
| SHOP_OWNER (a *different* shop, e.g. shop 3) | Used only for the "another shop can't see this" checks |

**If you don't remember a real shop-owner/employee password**, create
throwaway ones once, directly in the database (this uses the same password
as the admin account above, `Admin@123`, just pre-hashed):

```sql
-- run this with: docker exec -it inventory_postgres psql -U postgres -d inventory_db_dev
INSERT INTO users (shop_id, name, email, password_hash, role, is_active)
VALUES
  (2, 'Test Owner',    'test-owner@test.local',    '$2b$10$WvxwrLL61hRVxOCK3n8iFuTPKdgQz6hmq/DhMoW/Cxatnf3XIS.Zq', 'SHOP_OWNER', TRUE),
  (2, 'Test Employee', 'test-employee@test.local', '$2b$10$WvxwrLL61hRVxOCK3n8iFuTPKdgQz6hmq/DhMoW/Cxatnf3XIS.Zq', 'EMPLOYEE',   TRUE),
  (3, 'Test Owner 2',  'test-owner2@test.local',   '$2b$10$WvxwrLL61hRVxOCK3n8iFuTPKdgQz6hmq/DhMoW/Cxatnf3XIS.Zq', 'SHOP_OWNER', TRUE)
ON CONFLICT (email) DO UPDATE SET is_active = TRUE;
```

All three then log in with password `Admin@123`. Delete or deactivate them
when you're done testing (see the cleanup note at the very end).

---

## Part 1 — Login

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@warehouse.com","password":"Admin@123"}'
```

**Expected:** `200`, a JSON body with `data.accessToken`. Copy that token —
you'll use it as `ADMIN_TOKEN` below.

Repeat the same call for your shop-owner account (`OWNER_TOKEN`), your
employee account (`EMP_TOKEN`), and the other shop's owner
(`OWNER2_TOKEN`).

---

## Part 2 — Suppliers (the new feature)

### Step 2.1 — Create a supplier

```bash
curl -X POST http://localhost:3001/suppliers \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Big Center Distribution","phone":"0988111222","note":"Delivers Sundays"}'
```

**Expected:** `201`, returns the new supplier with an `id`. **Save this id**
— you'll reuse it as `SUPPLIER_ID` in the next steps.

### Step 2.2 — Same phone again → rejected

```bash
curl -X POST http://localhost:3001/suppliers \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Another Supplier","phone":"0988111222"}'
```

**Expected:** `409`, message about the phone already being used.

### Step 2.3 — List suppliers

```bash
curl http://localhost:3001/suppliers \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

**Expected:** `200`, an array with the supplier from Step 2.1. Each row
carries `open_debts_count` and `total_remaining` (both `0` right now — no
bills exist yet).

### Step 2.4 — Get one supplier

```bash
curl http://localhost:3001/suppliers/$SUPPLIER_ID \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

**Expected:** `200`, the supplier's full details.

### Step 2.5 — Update it

```bash
curl -X PATCH http://localhost:3001/suppliers/$SUPPLIER_ID \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note":"Delivers Sundays, cash on delivery"}'
```

**Expected:** `200`, `note` field updated, everything else unchanged.

### Step 2.6 — Another shop can't see it

```bash
curl http://localhost:3001/suppliers/$SUPPLIER_ID \
  -H "Authorization: Bearer $OWNER2_TOKEN"
```

**Expected:** `404` — **not** `403`. Another shop shouldn't even be able to
tell this supplier exists.

### Step 2.7 — Admin also can't see it

```bash
curl http://localhost:3001/suppliers/$SUPPLIER_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** `404`. This is intentional — a shop's suppliers are its own
business, the admin has no cross-shop view here (same rule as Customers).

### Step 2.8 — Employees are blocked entirely

```bash
curl http://localhost:3001/suppliers \
  -H "Authorization: Bearer $EMP_TOKEN"
```

**Expected:** `403`. Managing suppliers is owner-level, not staff-level.

### Step 2.9 — Deactivate it

```bash
curl -X DELETE http://localhost:3001/suppliers/$SUPPLIER_ID \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

**Expected:** `200`, `is_active: false`. It should disappear from Step 2.3's
list now (try it again) unless you add `?includeInactive=true`.

> **Not testable yet:** trying to deactivate a supplier who is still owed
> money should be blocked (`400 HAS_OPEN_DEBT`) — but there's no way to
> create a supplier bill yet, so there's nothing to owe. That comes in the
> next piece of work.

---

## Part 3 — Confirm the existing Debts endpoints still work

These endpoints already existed before this work — this section is a
**regression check**, confirming nothing broke.

### Step 3.1 — List debts

```bash
curl http://localhost:3001/debts \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** `200`, a paginated list of existing order/receipt debts. No
supplier bills should appear (there aren't any yet, but this also proves
the new filtering doesn't hide real receivables).

### Step 3.2 — Receivables summary

```bash
curl http://localhost:3001/debts/summary \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** `200`, `total_billed` / `total_collected` / `total_remaining`
/ `open_count` / `refund_due`.

### Step 3.3 — Same numbers via the analytics route

```bash
curl http://localhost:3001/analytics/receivables \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** identical numbers to Step 3.2 — both routes read the same
data.

### Step 3.4 — Aging report

```bash
curl http://localhost:3001/analytics/receivables/aging \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** `200`, always exactly 3 rows (`0-30`, `31-60`, `60+`), even if
a bucket is empty.

### Step 3.5 — One debt's detail (pick a real id from Step 3.1)

```bash
curl http://localhost:3001/debts/$DEBT_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** `200`, full debt object with a `remaining` field.

### Step 3.6 — Its payment history

```bash
curl http://localhost:3001/debts/$DEBT_ID/payments \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** `200`, array of payments, oldest first.

### Step 3.7 — Try to cancel a real (receivable) debt by id → rejected

```bash
curl -X POST http://localhost:3001/debts/$DEBT_ID/cancel \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"testing"}'
```

**Expected:** `400`, message that this debt must be cancelled through its
order or receipt, not directly. This is the **new** cancel-by-id endpoint —
this call proves it correctly refuses to touch a normal receivable. (It only
accepts supplier bills, which don't exist yet.)

### Step 3.8 — A shop's two-sided summary

```bash
curl http://localhost:3001/shops/2/debts/summary \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** `200`, `owed_by_shop` and `owed_to_shop` blocks, same numbers
as before this work started.

---

## What you can't test yet, and why

The database and the safety rules are fully in place, but there is still
**no endpoint to actually create a supplier bill or pay one**. That's the
very next piece of work. Once it exists, this guide will get a Part 4
covering: recording a bill, paying it (in full or in part), paying several
bills at once, and successfully cancelling one.

---

## Cleanup

If you created the throwaway accounts from the Prerequisites section:

```sql
-- only works if the account never created a debt/payment — otherwise
-- deactivate instead of delete:
DELETE FROM users WHERE email IN ('test-owner@test.local', 'test-employee@test.local', 'test-owner2@test.local');

-- if the delete fails with a foreign key error, use this instead:
UPDATE users SET is_active = FALSE WHERE email IN ('test-owner@test.local', 'test-employee@test.local', 'test-owner2@test.local');
```

If you created the test supplier from Step 2.1 and want it gone completely
rather than just deactivated:

```sql
DELETE FROM suppliers WHERE id = <SUPPLIER_ID>;
```
