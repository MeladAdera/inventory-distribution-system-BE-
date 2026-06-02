# Phase 2: Migrations

Run database migrations to create tables and schema.

## What are Migrations?

Migrations are SQL files that define your database schema. They're stored in `src/migrations/` and create tables, indexes, and relationships.

## Migration Files

```
src/migrations/
├── 00-CreateShopsAndUsers.sql
├── 01-CreateProductsAndCategories.sql
├── 02-CreateInventorySystem.sql
├── 03-CreateOrdersSystem.sql
├── 04-CreateWalletAndNotifications.sql
└── runner.ts  (Migration executor)
```

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

The migrations create these tables:

- `shops` - Shop information
- `users` - Users (OWNER, EMPLOYEE, CLIENT_ADMIN roles)
- `categories` - Product categories
- `products` - Product catalog
- `shop_products` - Shop access to products
- `inventory` - Stock levels
- `inventory_movements` - Stock transactions
- `orders` - Purchase orders
- `order_items` - Order line items
- `wallets` - Payment wallets
- `wallet_transactions` - Wallet transactions
- `notifications` - User notifications

## Verify Migrations Ran

Check if migrations completed successfully:

```bash
# See migration status
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "SELECT * FROM migrations;"
```

Expected output shows all migration files listed with timestamps.

## Creating New Migrations

### When You Add New Tables:

```bash
# Auto-generate migration file
npm run migration:create CreateNewTable
# Creates: src/migrations/{TIMESTAMP}-CreateNewTable.sql
```

### Then Edit and Add SQL:

```sql
-- src/migrations/{timestamp}-CreateNewTable.sql

CREATE TABLE new_table (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_new_table_name ON new_table(name);
```

## Next Step

✅ Migrations ran? → [Phase 3: Verify PostgreSQL](./03-verify-postgres.md)
