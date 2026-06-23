# Users — Feature Documentation

## Overview

User management for the entire system. The `WAREHOUSE_ADMIN` provisions shop owners (and their shops in one atomic transaction). Shop owners provision their own employees. All accounts are read, updated, and deactivated through this module — no self-registration exists anywhere in the system.

---

## Business Rules

- No public registration. Every account is created by a privileged role.
- `WAREHOUSE_ADMIN` creates shop owners via `POST /users/shop-owners`, which creates the shop and the owner in one database transaction. If either insert fails, both roll back.
- `SHOP_OWNER` creates employees via `POST /users/employees`. The employee is always assigned to the owner's shop automatically — the caller cannot assign a different shop.
- Passwords are hashed with bcrypt (cost factor 10) before storage. The raw password never appears in any response.
- All read/write endpoints return `SafeUser` — the `password_hash` field is never included in any response.
- Deactivation is a soft delete — `is_active` is set to `FALSE`. The account remains in the database and can be seen in audit logs.
- The `WAREHOUSE_ADMIN` account cannot be deactivated by anyone.
- A user cannot deactivate their own account.

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `POST /users/shop-owners` | ✅ | 403 | 403 |
| `POST /users/employees` | 403 | ✅ Own shop | 403 |
| `GET /users` | All users | Own shop only | 403 |
| `GET /users/:id` | Any user | Own shop only | 403 |
| `PATCH /users/:id` | Any user | Own employees only | 403 |
| `DELETE /users/:id` | Any non-admin user | Own employees only | 403 |

---

## Endpoints

### `POST /users/shop-owners`
**Role:** `WAREHOUSE_ADMIN`

Creates a new `SHOP` record and a `SHOP_OWNER` user in a single transaction.

**Body:**
```json
{
  "shopName": "MD Market",
  "shopAddress": "123 Main St",
  "ownerName": "Ahmed Hassan",
  "email": "ahmed@mdmarket.com",
  "password": "Password123"
}
```

**Returns:** The created user (`SafeUser` — no password).

---

### `POST /users/employees`
**Role:** `SHOP_OWNER`

Creates an `EMPLOYEE` assigned to the caller's shop. The shop is taken from the JWT — not from the request body.

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@mdmarket.com",
  "password": "Password123"
}
```

**Returns:** The created user (`SafeUser`).

---

### `GET /users`
**Role:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Returns a paginated list of users. `SHOP_OWNER` results are automatically scoped to their own shop — they cannot see users from other shops even if they pass `?shop_id=`.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `role` | `WAREHOUSE_ADMIN` \| `SHOP_OWNER` \| `EMPLOYEE` | Filter by exact role |
| `shop_id` | number | Filter by shop (WAREHOUSE_ADMIN only — ignored for SHOP_OWNER) |
| `search` | string | Case-insensitive match against name or email |
| `page` | number | Default `1` |
| `limit` | number | Default `10` |

**Returns:** Paginated `SafeUser[]` with `shop_name` included.

---

### `GET /users/:id`
**Role:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Returns a single user. `SHOP_OWNER` gets a `404` if the user exists but belongs to a different shop — this prevents probing for valid IDs.

**Returns:** `SafeUser` with `shop_name`.

---

### `PATCH /users/:id`
**Role:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Updates `name` and/or `email`. At least one field must be provided. If `email` is changed, uniqueness is checked before saving.

`SHOP_OWNER` can only update `EMPLOYEE` users in their own shop — attempting to update another `SHOP_OWNER` returns `403`.

**Body (all optional, at least one required):**
```json
{
  "name": "Ahmed Al-Hassan",
  "email": "newemail@mdmarket.com"
}
```

**Returns:** Updated `SafeUser`.

**Errors:**
- `404` — user not found (or out of scope)
- `403` — SHOP_OWNER targeting a non-employee
- `409` — email already taken
- `400` — no fields provided

---

### `DELETE /users/:id`
**Role:** `WAREHOUSE_ADMIN`, `SHOP_OWNER`

Soft-deletes a user by setting `is_active = FALSE`.

**Guards:**
- Cannot deactivate yourself (`400`)
- Cannot deactivate `WAREHOUSE_ADMIN` (`403`)
- `SHOP_OWNER` can only deactivate their own employees (`403` otherwise)

**Returns:** The deactivated `SafeUser` with `is_active: false`.

---

## SafeUser Shape

Every users endpoint returns this shape (no `password_hash`):

```json
{
  "id": 2,
  "shop_id": 2,
  "shop_name": "MD Market",
  "name": "Ahmed Hassan",
  "email": "ahmed@mdmarket.com",
  "role": "SHOP_OWNER",
  "is_active": true,
  "created_at": "2026-06-03T17:00:48.157Z",
  "updated_at": "2026-06-03T17:00:48.157Z"
}
```

---

## Key Implementation Notes

- `createShopOwner` runs in a `db.transaction()` — shop insert and user insert share the same `PoolClient`. If the user insert fails (e.g. duplicate email), the shop is also rolled back.
- `findPaginated` uses `COUNT(*) OVER()` window function — total count and page data come from one query, not two.
- Shop scoping is applied in the service (`shopIdScope` param), not the repository. The repository is scope-agnostic.
- `SafeUser` is a separate class from `User` — the entity file has both. `User` (with `password_hash`) is used only by `AuthService` for login. All other callers use `SafeUser`.

---

## Error Keys (i18n)

Translation files: `i18n/en/users.json`, `i18n/ar/users.json`

| Key | HTTP | Thrown when |
|---|---|---|
| `users.NOT_FOUND` | 404 | User ID does not exist or is outside the caller's shop scope |
| `users.EMAIL_TAKEN` | 409 | Email is already registered to another user |
| `users.CANNOT_DEACTIVATE_SELF` | 400 | Caller tries to deactivate their own account |
| `users.CANNOT_DEACTIVATE_WAREHOUSE_ADMIN` | 403 | Anyone tries to deactivate the warehouse admin |
| `users.SHOP_OWNER_UPDATE_RESTRICTED` | 403 | `SHOP_OWNER` tries to update a non-employee |
| `users.SHOP_OWNER_DEACTIVATE_RESTRICTED` | 403 | `SHOP_OWNER` tries to deactivate a non-employee |
| `users.NO_FIELDS_TO_UPDATE` | 400 | `PATCH` body resolves to no updatable fields |

> See `docs/features/10-i18n-localization.md` for how keys are detected and translated.
