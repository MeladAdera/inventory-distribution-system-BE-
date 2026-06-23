# Shops — Feature Documentation

## Overview

Shop management for the Inventory Distribution System.
Warehouse Admins manage all shops. Shop Owners and Employees can only view and (for owners) update their own shop.

---

## Business Rules

- No physical deletion — shops are soft-deleted via `is_active = false`.
- The `WAREHOUSE` shop (`type = 'WAREHOUSE'`) cannot be deactivated.
- A user whose shop is inactive is blocked at login with `401 Your shop has been deactivated`.
- A user whose own `is_active` is false is also blocked at login.

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `GET /shops` | All shops | Own shop only | Own shop only |
| `GET /shops/:id` | Any shop | Own shop only (403 otherwise) | Own shop only (403 otherwise) |
| `PATCH /shops/:id` | Any shop | Own shop only (403 otherwise) | Forbidden (403) |
| `PATCH /shops/:id/status` | Any shop | Forbidden (403) | Forbidden (403) |

---

## Endpoints

### GET /shops

Returns all shops for `WAREHOUSE_ADMIN`. Returns the caller's own shop (single object) for `SHOP_OWNER` and `EMPLOYEE`.

**Headers:** `Authorization: Bearer <token>`

**WAREHOUSE_ADMIN response:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Main Warehouse", "address": "Central Location", "phone": null, "type": "WAREHOUSE", "is_active": true },
    { "id": 2, "name": "MD Market", "address": "Amman, Jordan", "phone": null, "type": "SHOP", "is_active": true }
  ]
}
```

**SHOP_OWNER / EMPLOYEE response:**
```json
{
  "success": true,
  "data": { "id": 2, "name": "MD Market", "address": "Amman, Jordan", "phone": null, "type": "SHOP", "is_active": true }
}
```

---

### GET /shops/:id

Returns a single shop by ID.

- `404` if the shop does not exist.
- `403` if a non-admin requests a shop other than their own.

---

### PATCH /shops/:id

Updates `name`, `address`, and/or `phone`. All fields are optional — only sent fields are updated.

**Request body:**
```json
{ "name": "New Name", "address": "New Address", "phone": "0501234567" }
```

- `404` if shop does not exist.
- `403` if `SHOP_OWNER` tries to update a different shop.
- `403` if `EMPLOYEE` calls this endpoint.

---

### PATCH /shops/:id/status

Activates or deactivates a shop (`WAREHOUSE_ADMIN` only).

**Request body:**
```json
{ "isActive": false }
```

- `400` if attempting to deactivate the `WAREHOUSE` shop.
- `404` if shop does not exist.

---

## DTOs

### UpdateShopDto — `src/shops/dto/update-shop.dto.ts`

| Field | Type | Required |
|---|---|---|
| `name` | `string` | No |
| `address` | `string` | No |
| `phone` | `string` | No |

### UpdateShopStatusDto — `src/shops/dto/update-shop-status.dto.ts`

| Field | Type | Required |
|---|---|---|
| `isActive` | `boolean` | Yes |

---

## Migration

`06-AddShopIsActive.sql` — adds `is_active BOOLEAN NOT NULL DEFAULT TRUE` to the `shops` table.
Runs automatically on startup via the migration runner (tracked in the `migrations` table, runs once).

---

## File Map

```
src/shops/
├── shops.module.ts                       registers ShopsController, ShopsService, ShopsRepository
├── controllers/
│   └── shops.controller.ts              GET /shops, GET /shops/:id, PATCH /shops/:id, PATCH /shops/:id/status
├── services/
│   └── shops.service.ts                 findAll, findById, update, updateStatus — role enforcement here
├── repositories/
│   └── shops.repository.ts              findAll, findById, update (dynamic SET), updateStatus
├── entities/
│   └── shop.entity.ts                   id, name, address, phone, type, is_active, created_at, updated_at
└── dto/
    ├── update-shop.dto.ts
    └── update-shop-status.dto.ts

src/database/migrations/
└── 06-AddShopIsActive.sql               ALTER TABLE shops ADD COLUMN is_active
```

---

## Auth Integration

Login now enforces shop status. After password validation, `auth.service.ts` checks:

1. `user.is_active === false` → `401 Your account has been deactivated`
2. `user.shop_id !== null && shop.is_active === false` → `401 Your shop has been deactivated`

This is achieved via a single `LEFT JOIN shops` in `UsersRepository.findByEmail` — no extra round trip to the database.

---

## Error Keys (i18n)

Translation files: `i18n/en/shops.json`, `i18n/ar/shops.json`

| Key | HTTP | Thrown when |
|---|---|---|
| `shops.NOT_FOUND` | 404 | Shop ID does not exist |
| `shops.VIEW_OWN_ONLY` | 403 | Non-admin tries to view a shop other than their own |
| `shops.UPDATE_OWN_ONLY` | 403 | `SHOP_OWNER` tries to update a shop other than their own |
| `shops.CANNOT_DEACTIVATE_WAREHOUSE` | 400 | Anyone tries to set the warehouse shop to inactive |

> See `docs/features/10-i18n-localization.md` for how keys are detected and translated.
