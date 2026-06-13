# Phase 5: Seed the Database

The seeder populates the database with realistic test data so you can start testing the API immediately without manual setup.

## What Gets Seeded

| Entity | Count | Details |
|---|---|---|
| Shops | 4 | 1 Warehouse + 3 Shops |
| Users | 8 | 1 Admin, 3 Owners, 3 Employees, 1 Inactive |
| Categories | 10 | Warehouse-global + shop-specific |
| Products | 15 | 11 Warehouse global + 3 Local + 1 Inactive |
| Inventory | 36 rows | Across all shops, including low-stock entries |
| Orders | 7 | Mixed statuses (COMPLETED, SHIPPED, PROCESSING, PENDING) |
| Order Items | 27 | Across all orders |
| Notifications | 9 | Low-stock, order updates, system messages |
| Audit Logs | 13 | Inventory, order, user, and product events |

## Running the Seeder

```bash
npm run seed
```

> **Warning:** The seeder **clears all existing data** and resets all ID sequences before inserting. Do not run it against a production database.

## Test Credentials

| Email | Password | Role | Shop |
|---|---|---|---|
| `admin@warehouse.com` | `Admin@123` | `WAREHOUSE_ADMIN` | Main Warehouse |
| `alice@downtown.com` | `Owner@123` | `SHOP_OWNER` | Downtown Shop |
| `bob@uptown.com` | `Owner@123` | `SHOP_OWNER` | Uptown Shop |
| `carol@eastside.com` | `Owner@123` | `SHOP_OWNER` | Eastside Branch |
| `david@downtown.com` | `Employee@123` | `EMPLOYEE` | Downtown Shop |
| `eva@downtown.com` | `Employee@123` | `EMPLOYEE` | Downtown Shop |
| `frank@uptown.com` | `Employee@123` | `EMPLOYEE` | Uptown Shop |
| `ghost@downtown.com` | `Employee@123` | `EMPLOYEE` (inactive) | Downtown Shop |

## Notable Edge Cases in Seed Data

- **Low-stock items** — Downtown Shop: USB-C Hub (15 units, threshold 10) and Energy Drink (5 units, threshold 15). Eastside Branch: Hand Sanitizer (9 units, threshold 15). Useful for testing `GET /inventory/low-stock` and stock status filters on `GET /products?stock_status=LOW_STOCK`.
- **Inactive product** — Product #15 (`source = WAREHOUSE`, `is_active = FALSE`). Use `GET /products?is_active=false` (admin only) to see it.
- **Inactive user** — `ghost@downtown.com` (`is_active = FALSE`). Login is blocked for inactive accounts.
- **In-flight orders** — Orders 4 (SHIPPED), 5 (PROCESSING), 6–7 (PENDING) let you test status transitions without creating new orders.

## Source

`src/database/seeders/seed.ts`
