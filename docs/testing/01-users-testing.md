# How to Test: Users

## Prerequisites

1. Docker running: `docker compose up -d`
2. Migrations applied: `npm run migration:run`
3. App running: `npm run start:dev`

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

## Step 2 — Create a shop owner (also creates the shop)

```bash
curl -X POST http://localhost:3000/users/shop-owners \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "shopName": "MD Market",
    "shopAddress": "123 Main St",
    "ownerName": "Ahmed Hassan",
    "email": "ahmed@mdmarket.com",
    "password": "Password123"
  }'
```

Expected: `201` with `SafeUser` — no `password_hash` in the response. Note the `id` for later steps.

```bash
OWNER_ID=2   # use the id from the response
```

---

## Step 3 — Login as the shop owner

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ahmed@mdmarket.com","password":"Password123"}'
```

```bash
OWNER_TOKEN="paste-token-here"
```

---

## Step 4 — Create an employee (as shop owner)

```bash
curl -X POST http://localhost:3000/users/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{
    "name": "John Doe",
    "email": "john@mdmarket.com",
    "password": "Password123"
  }'
```

Expected: `201`. Employee is automatically assigned to the owner's shop — no `shop_id` in the body.

```bash
EMP_ID=3   # use the id from the response
```

---

## Step 5 — List all users (as admin)

```bash
curl http://localhost:3000/users \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: all 3 users (admin + owner + employee) paginated.

---

## Step 6 — Filter by role

```bash
# Only shop owners
curl "http://localhost:3000/users?role=SHOP_OWNER" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Only employees
curl "http://localhost:3000/users?role=EMPLOYEE" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Step 7 — Search by name or email

```bash
curl "http://localhost:3000/users?search=ahmed" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: returns Ahmed Hassan (partial case-insensitive match on name and email).

---

## Step 8 — List users as shop owner (scoped)

```bash
curl http://localhost:3000/users \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: only users in MD Market (the owner + their employee). The warehouse admin is NOT in the list.

---

## Step 9 — Get a single user

```bash
# Admin fetches any user
curl http://localhost:3000/users/$OWNER_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Owner fetches their employee
curl http://localhost:3000/users/$EMP_ID \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: `SafeUser` with `shop_name` populated.

---

## Step 10 — Shop owner cannot see users from other shops

```bash
# Try to fetch the admin (id=1) as shop owner — should be 404, not 403
curl http://localhost:3000/users/1 \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

Expected: `404 Not Found`. The shop owner gets a 404 (not 403) so they can't tell whether user id=1 exists at all.

---

## Step 11 — Update a user

```bash
# Admin updates the owner's name
curl -X PATCH http://localhost:3000/users/$OWNER_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name": "Ahmed Al-Hassan"}'
```

Expected: `200` with updated `SafeUser`.

```bash
# Owner updates their employee's email
curl -X PATCH http://localhost:3000/users/$EMP_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"email": "john.new@mdmarket.com"}'
```

---

## Step 12 — Conflict: duplicate email

```bash
curl -X PATCH http://localhost:3000/users/$EMP_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"email": "ahmed@mdmarket.com"}'
```

Expected: `409 Conflict` — that email is already used by the owner.

---

## Step 13 — Deactivate a user

```bash
curl -X DELETE http://localhost:3000/users/$EMP_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `200` with `SafeUser` where `is_active: false`. The user still exists in the DB.

---

## Step 14 — Guard: cannot deactivate yourself

```bash
# Admin tries to delete themselves (id=1)
curl -X DELETE http://localhost:3000/users/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `400 Bad Request` — "You cannot deactivate your own account".

---

## Step 15 — Guard: cannot deactivate warehouse admin

```bash
# Any admin trying to deactivate user id=1 (the warehouse admin)
curl -X DELETE http://localhost:3000/users/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `400` (self-deactivation guard fires first since the admin is deactivating themselves).

To test the admin-protection guard specifically, you would need a second WAREHOUSE_ADMIN account — which the current system doesn't support. The guard is in place regardless.
