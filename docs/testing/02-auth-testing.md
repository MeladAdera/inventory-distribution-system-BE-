# How to Test: Auth & User Provisioning

## Prerequisites

1. Docker running: `docker compose up -d`
2. Migrations applied: `npm run migration:run`
3. App running: `npm run start:dev`

---

## Step 1 — Login as Warehouse Admin

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@warehouse.com","password":"Admin@123"}'
```

Expected response:
```json
{
  "success": true,
  "data": {
    "accessToken": "<token>",
    "user": { "id": 1, "email": "admin@warehouse.com", "role": "WAREHOUSE_ADMIN", "shopId": null }
  }
}
```

Save the token:
```bash
TOKEN="paste-your-token-here"
```

---

## Step 2 — Get Current User

```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `{ "id": 1, "email": "admin@warehouse.com", "role": "WAREHOUSE_ADMIN", "shopId": null }`

---

## Step 3 — Create a Shop + Shop Owner

```bash
curl -X POST http://localhost:3000/users/shop-owners \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "shopName": "MD Market",
    "ownerName": "Ahmed",
    "email": "ahmed@mdmarket.com",
    "password": "Password123"
  }'
```

Expected: user returned with `role: SHOP_OWNER` and a `shop_id`.

---

## Step 4 — Login as Shop Owner

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ahmed@mdmarket.com","password":"Password123"}'
```

Save the new token:
```bash
OWNER_TOKEN="paste-owner-token-here"
```

---

## Step 5 — Create an Employee

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

Expected: user returned with `role: EMPLOYEE` and same `shop_id` as the owner.

---

## Step 6 — Verify Role Enforcement

### Wrong password → 401
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@warehouse.com","password":"wrongpass"}'
```
Expected: `statusCode: 401`

### No token → 401
```bash
curl http://localhost:3000/auth/me
```
Expected: `statusCode: 401`

### Employee tries to create users → 403
```bash
EMP_TOKEN="paste-employee-token-here"

curl -X POST http://localhost:3000/users/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EMP_TOKEN" \
  -d '{"name":"Jane","email":"jane@shop.com","password":"Password123"}'
```
Expected: `statusCode: 403, message: "You do not have permission to perform this action"`

### SHOP_OWNER tries to create shop owners → 403
```bash
curl -X POST http://localhost:3000/users/shop-owners \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{"shopName":"X","ownerName":"X","email":"x@x.com","password":"pass123"}'
```
Expected: `statusCode: 403`

---

## Step 7 — Swagger UI (optional)

Open in browser: `http://localhost:3000/api`

1. Click `POST /auth/login` → Execute → copy `accessToken`
2. Click **Authorize** (top right) → paste token
3. All bearer-protected endpoints will now work from the UI
