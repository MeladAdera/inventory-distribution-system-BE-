# Database Migration Guide

This guide explains how to work with database migrations in this project.

## Overview

Migrations are SQL files that manage database schema changes. They are automatically executed in order when the application starts.

## Migration Files

Migrations are located in `src/migrations/` and are executed in alphabetical order:

1. **00-CreateShopsAndUsers.sql** - Creates shops and users tables
2. **01-CreateProductsAndCategories.sql** - Creates products and categories
3. **02-CreateInventorySystem.sql** - Creates inventory and warehouse system
4. **03-CreateOrdersSystem.sql** - Creates orders system
5. **04-CreateWalletAndNotifications.sql** - Creates wallet and notifications

## Running Migrations

### Automatic (Recommended)
Migrations run automatically when the application starts:

```bash
npm start
```

### Manual
To manually run migrations:

```bash
npm run migrate
```

Or with Docker:

```bash
docker-compose exec app npm run migrate
```

## Creating a New Migration

1. Create a new SQL file in `src/migrations/` with a descriptive name:
   ```bash
   touch src/migrations/05-AddNewFeature.sql
   ```

2. Write your migration SQL:
   ```sql
   CREATE TABLE new_feature (
     id SERIAL PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```

3. The migration will run automatically on next application start.

## Migration Tracking

The system tracks executed migrations in the `migrations` table:

```sql
SELECT * FROM migrations;
```

This table prevents the same migration from running twice.

## Rollback Strategies

The current system doesn't support automatic rollbacks. For rollbacks:

1. Create a new migration that reverses the changes:
   ```sql
   DROP TABLE table_name;
   ```

2. Or manually execute SQL in your database:
   ```bash
   docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "DROP TABLE table_name;"
   ```

## Best Practices

- Keep migrations small and focused
- Use explicit column types and constraints
- Always include indexes for frequently queried columns
- Add timestamps (created_at, updated_at) to tables
- Use foreign keys with appropriate ON DELETE actions
- Test migrations locally before deployment

## Troubleshooting

### Migration Failed

Check logs:
```bash
docker-compose logs app
```

Reset migrations (dangerous!):
```bash
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "DROP TABLE migrations;"
```

Then restart:
```bash
docker-compose restart app
```

### Database is Locked

Wait for the previous operation to complete or restart services:
```bash
docker-compose restart postgres
```
