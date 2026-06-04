# Products — Feature Documentation

## Overview

Product management for the Inventory Distribution System.
Products belong to a shop and a category. Warehouse products (`source = WAREHOUSE`) are global — visible to all shops. Local products (`source = LOCAL`) belong to a specific shop only.

`source` is **auto-determined** from the target shop's type — users cannot set it manually.

---

## Business Rules

- Every product belongs to one shop via `shop_id`.
- `source` is set automatically: warehouse shop → `WAREHOUSE`, any other shop → `LOCAL`.
- `is_global` mirrors `source`: `TRUE` for warehouse products, `FALSE` for local.
- `barcode` is optional but must be **unique per shop** when provided.
- The `category_id` must reference a category accessible to the target shop (own or warehouse category).
- **Soft delete only** — `DELETE` sets `is_active = FALSE`. Hard delete is blocked because `inventory` and `order_items` both cascade on `product_id`, which would wipe stock records and order history.
- Soft-deleted products are invisible in all queries (`WHERE is_active = TRUE`).
- `EMPLOYEE` is read-only.

---

## Role Matrix

| Action | WAREHOUSE_ADMIN | SHOP_OWNER | EMPLOYEE |
|---|---|---|---|
| `GET /products` | All products (filters optional) | Own + warehouse products | Own + warehouse products |
| `GET /products/:id` | Any | Own + warehouse (403 otherwise) | Own + warehouse (403 otherwise) |
| `POST /products` | Defaults to warehouse; `?shop_id=X` for another shop | Own shop | 403 |
| `PATCH /products/:id` | Any | Own shop only | 403 |
| `DELETE /products/:id` | Any (soft delete) | Own shop only (soft delete) | 403 |

---

## Endpoints

### GET /products

Returns a paginated list of active products.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 10) |
| `source` | `WAREHOUSE` \| `LOCAL` | Filter by product source |
| `category_id` | number | Filter by category |
| `shop_id` | number | Admin only — filter by specific shop |

**Response shape:**
```json
{
  "data": [...],
  "page": 1,
  "limit": 10,
  "total": 42,
  "totalPages": 5,
  "hasNext": true,
  "hasPrev": false
}
```

---

### GET /products/:id

Returns a single active product.

- `404` if product does not exist or is soft-deleted.
- `403` if non-admin requests a product that is neither theirs nor a warehouse product.

---

### POST /products

Creates a product. `source` and `is_global` are auto-set from the shop's type — do not pass them in the body.

**Request body:**
```json
{
  "name": "Mineral Water 500ml",
  "price": 0.5,
  "category_id": 1,
  "barcode": "6281234567890",
  "description": "Natural spring water"
}
```

- Admin: defaults to warehouse shop. Pass `?shop_id=X` to create for another shop.
- SHOP_OWNER: always creates in their own shop.
- `409` if barcode already exists in the target shop.
- `400` if category is not accessible to the target shop.

---

### PATCH /products/:id

Updates product fields. Only provided fields are changed.

**Request body** (all optional):
```json
{
  "name": "Updated Name",
  "price": 1.5,
  "barcode": "newbarcode",
  "category_id": 2,
  "description": "Updated description"
}
```

- `409` if new barcode conflicts with an existing product in the same shop.
- `400` if new `category_id` is not accessible to the product's shop.
- `403` if shop owner tries to edit another shop's product.

---

### DELETE /products/:id

Soft-deletes the product (`is_active = FALSE`). Returns `204 No Content`.

- Inventory records and order history are preserved.
- `403` if shop owner tries to delete another shop's product.

---

## DTOs

### CreateProductDto — `src/products/dto/create-product.dto.ts`

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | Yes | 3–150 characters |
| `price` | number | Yes | > 0, max 2 decimal places |
| `category_id` | number | Yes | Must be accessible to the shop |
| `barcode` | string | No | Unique per shop |
| `description` | string | No | Free text |

### UpdateProductDto — `src/products/dto/update-product.dto.ts`

Same fields as above, all optional.

### ProductQueryDto — `src/products/dto/product-query.dto.ts`

Extends `PaginationDto` (`page`, `limit`) and adds `source?`, `category_id?`, `shop_id?`.

---

## Migration

`09-AddProductPriceAndSoftDelete.sql`:
- `ALTER TABLE products ADD COLUMN price DECIMAL(10,2)`
- `ALTER TABLE products ADD COLUMN updated_at TIMESTAMP`
- `ALTER TABLE products ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE`
- `CREATE UNIQUE INDEX ON products(shop_id, barcode) WHERE barcode IS NOT NULL`

The partial unique index allows multiple products with no barcode in the same shop while still enforcing uniqueness when a barcode is provided.

---

## Key Design Decisions

### Why soft delete?

`order_items.product_id` and `inventory.product_id` both use `ON DELETE CASCADE`. Hard-deleting a product would cascade and destroy:
- All inventory stock records for that product
- All order line items referencing that product (destroying order history)

Soft delete (`is_active = FALSE`) hides the product without touching any related records.

### Why is `source` auto-set?

Allowing users to set `source` freely would let a shop owner mark their local product as `WAREHOUSE`, making it visible to all other shops. Auto-setting from the shop's type closes that loophole entirely.

### Pagination with `COUNT(*) OVER()`

The repository uses a PostgreSQL window function to return data and total count in a single query — no separate `SELECT COUNT(*)` needed.

---

## File Map

```
src/products/
├── products.module.ts                    registers controller, service, repository
├── controllers/
│   └── products.controller.ts           GET /products, GET /products/:id,
│                                        POST /products, PATCH /products/:id,
│                                        DELETE /products/:id
├── services/
│   └── products.service.ts              findAll, findById, create, createForShop,
│                                        update, remove
│                                        assertAccess(), assertOwnership(), resolveShopId()
├── repositories/
│   └── products.repository.ts           findPaginatedAdmin, findPaginatedForShop,
│                                        findById, findByBarcodeAndShop,
│                                        categoryAccessible, insert, update, softDelete
├── entities/
│   └── product.entity.ts                id, shop_id, category_id, name, description,
│                                        barcode, price, source, is_global,
│                                        is_active, created_at, updated_at
└── dto/
    ├── create-product.dto.ts            name, price, category_id, barcode?, description?
    ├── update-product.dto.ts            all optional
    └── product-query.dto.ts             extends PaginationDto + source?, category_id?, shop_id?

src/database/migrations/
└── 09-AddProductPriceAndSoftDelete.sql
```
