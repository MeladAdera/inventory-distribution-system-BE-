# Phase 2: Migrations

Run database migrations to create tables and schema.

## What are Migrations?

Migrations are SQL files that define your database schema. They're stored in `src/database/migrations/` and create tables, indexes, and relationships.

## Migration Files

```
src/database/migrations/
├── 00-InitialSchema.sql   ← complete schema, squashed (single source of truth)
└── runner.ts              ← migration executor
```

The schema currently lives in one squashed file rather than many incremental ones — this project hasn't shipped to a real environment yet, so there's no history to preserve. Once a real deployment has run migrations, new schema changes must be added as new numbered files (`01-...`, `02-...`) instead of editing `00-InitialSchema.sql`, since the runner tracks executed filenames in the `migrations` table and never re-runs one it already applied.

## Running Migrations

### Option 1: Automatic (Recommended)

Migrations run automatically when you start Docker:

```bash
docker-compose up -d
# App container runs: npm run migration:run && npm start
```

### Option 2: Manual Run

```bash
# Install dependencies first
npm install

# Run migrations
npm run migration:run
```

### Option 3: In Docker Container

```bash
# Execute inside app container
docker-compose exec app npm run migration:run
```

## What Gets Created?

The migration creates these tables:

### Core Tables
- `shops` - Warehouse and shop records
- `users` - Users (`WAREHOUSE_ADMIN`, `SHOP_OWNER`, `EMPLOYEE` roles)
- `refresh_tokens` - JWT refresh tokens

### Product Management
- `categories` - Product categories (shop-specific)
- `products` - Product catalog (category_id, shop_id, source: WAREHOUSE/LOCAL, price + cost_price)

### Inventory & Orders
- `inventory` - Stock levels by shop and product
- `orders` / `order_items` - Purchase orders between shops
- `receipts` / `receipt_items` - Point-of-sale stock deductions

### System
- `notifications` - User notifications
- `audit_logs` - Complete audit trail (inventory, order, product, category, user actions)

## Verify Migrations Ran

Check if migrations completed successfully:

```bash
# See migration status
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "SELECT * FROM migrations;"
```

Expected output shows all migration files listed with timestamps.

## Creating New Migrations

### When You Add New Tables or Columns:

```bash
# Auto-generate migration file
npm run migration:create CreateNewTable
# Creates: src/database/migrations/{TIMESTAMP}-CreateNewTable.sql
```

### Then Edit and Add SQL:

```sql
-- src/database/migrations/{timestamp}-CreateNewTable.sql

CREATE TABLE new_table (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_new_table_name ON new_table(name);
```

## Next Step

✅ Migrations ran? → [Phase 3: Verify PostgreSQL](./03-verify-postgres.md)
