# Categories — Feature Documentation

## Overview

Category management for organizing products within shops.
Categories are per-shop but the warehouse shop has **global categories** visible to all shops — shop owners see both their own categories and the warehouse's when browsing.

---

## Business Rules

- Categories belong to a specific shop via `shop_id`.
- The warehouse shop (`type = 'WAREHOUSE'`) holds **global categories** shared across all shops.
- `WAREHOUSE_ADMIN` is linked to the warehouse shop (`shop_id = 1`) — they create warehouse categories by default.
- Category names are **unique within a shop** (case-insensitive).
- A category **cannot be deleted** if products are assigned to it.
- `EMPLOYEE` is read-only — cannot create, update, or delete.

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `GET /categories` | All categories (or filter by `?shopId=`) | Own + warehouse categories | Own + warehouse categories |
| `GET /categories/:id` | Any | Own shop (403 otherwise) | Own shop (403 otherwise) |
| `POST /categories` | Defaults to warehouse; pass `?shopId=X` for another shop | Own shop | 403 |
| `PATCH /categories/:id` | Any | Own shop (403 otherwise) | 403 |
| `DELETE /categories/:id` | Any (if no products assigned) | Own shop + no products | 403 |

---

## Endpoints

### GET /categories

**Headers:** `Authorization: Bearer <token>`

- **Admin, no filter** → all categories from all shops
- **Admin, `?shopId=X`** → only that shop's categories
- **SHOP_OWNER / EMPLOYEE** → own categories + warehouse categories (merged, ordered by type then name)

---

### GET /categories/:id

Returns a single category. Non-admins get `403` if the category belongs to a different shop.

- `404` if category does not exist.

---

### POST /categories

**Request body:**
```json
{ "name": "Beverages" }
```

- `name` required, 3–100 characters.
- `409` if a category with the same name already exists in the target shop (case-insensitive).
- Admin: pass `?shopId=X` to create in a specific shop, otherwise creates in warehouse.
- SHOP_OWNER: always creates in their own shop.

---

### PATCH /categories/:id

**Request body:**
```json
{ "name": "Cold Beverages" }
```

- `name` optional, 3–100 characters.
- `409` if the new name already exists in the same shop (excludes the current category).
- `404` if category does not exist.
- `403` if non-admin tries to update another shop's category.

---

### DELETE /categories/:id

Returns `204 No Content` on success.

- `400` if products are assigned to this category — reassign or delete them first.
- `404` if category does not exist.
- `403` if non-admin tries to delete another shop's category.

---

## DTOs

### CreateCategoryDto — `src/categories/dto/create-category.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | Yes | 3–100 characters |

### UpdateCategoryDto — `src/categories/dto/update-category.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | No | 3–100 characters |

---

## Migrations

| File | What it does |
|---|---|
| `07-AddCategoryUpdatedAt.sql` | Adds `updated_at TIMESTAMP` column to `categories` table |
| `08-LinkWarehouseAdminToShop.sql` | Sets `shop_id = 1` (warehouse) on the `WAREHOUSE_ADMIN` user — enables warehouse category ownership |

---

## Repository Methods — `src/categories/repositories/categories.repository.ts`

| Method | Used by | Description |
|---|---|---|
| `findAll()` | Admin (no filter) | All categories across all shops |
| `findAllByShop(shopId)` | Admin (with `?shopId=`) | One specific shop's categories |
| `findAllForShop(shopId)` | SHOP_OWNER / EMPLOYEE | Own + warehouse categories via JOIN |
| `findById(id)` | All | Single category lookup |
| `findByNameAndShop(name, shopId, excludeId?)` | create/update | Case-insensitive uniqueness check |
| `insert(name, shopId)` | create | Inserts new category |
| `update(id, dto)` | update | Updates name + `updated_at` |
| `deleteById(id)` | delete | Hard delete |
| `hasProducts(categoryId)` | delete guard | Returns true if any product references this category |

---

## File Map

```
src/categories/
├── categories.module.ts                      registers controller, service, repository
├── controllers/
│   └── categories.controller.ts             GET /categories, GET /categories/:id,
│                                            POST /categories, PATCH /categories/:id,
│                                            DELETE /categories/:id
├── services/
│   └── categories.service.ts                findAll, findById, create, update, remove
│                                            resolveShopId(), assertShopAccess()
├── repositories/
│   └── categories.repository.ts             findAll, findAllByShop, findAllForShop,
│                                            findById, findByNameAndShop, insert,
│                                            update, deleteById, hasProducts
├── entities/
│   └── category.entity.ts                   id, shop_id, name, created_at, updated_at
└── dto/
    ├── create-category.dto.ts               name (required, 3–100)
    └── update-category.dto.ts               name (optional, 3–100)

src/database/migrations/
├── 07-AddCategoryUpdatedAt.sql
└── 08-LinkWarehouseAdminToShop.sql
```

---

## Key Design Decision — Warehouse as Global Shop

The warehouse admin (`WAREHOUSE_ADMIN`) is linked to the warehouse shop (`shop_id = 1`).
This means:

- Admin creates categories without specifying `?shopId=` → they land in the warehouse (global).
- Shop owners and employees see warehouse categories merged with their own when they call `GET /categories`.
- This is the foundation for the product ordering flow: shop owners browse warehouse products grouped by warehouse categories.

The merge query in `findAllForShop`:
```sql
SELECT c.* FROM categories c
JOIN shops s ON c.shop_id = s.id
WHERE c.shop_id = $1 OR s.type = 'WAREHOUSE'
ORDER BY s.type DESC, c.name
```
Warehouse categories sort first (`DESC` on type puts `WAREHOUSE` before `SHOP`).

---

## Error Keys (i18n)

Translation files: `i18n/en/categories.json`, `i18n/ar/categories.json`

| Key | HTTP | Thrown when |
|---|---|---|
| `categories.NOT_FOUND` | 404 | Category ID does not exist |
| `categories.NAME_TAKEN` | 409 | A category with the same name already exists in that shop |
| `categories.HAS_PRODUCTS` | 400 | Attempting to delete a category that still has products assigned |
| `categories.MANAGE_OWN_ONLY` | 403 | Non-admin tries to read/update/delete a category from another shop |

> See `docs/features/10-i18n-localization.md` for how keys are detected and translated.
