# Phase 3: Verify PostgreSQL

Check that migrations ran successfully and all tables exist using PostgreSQL CLI.

## Connect to PostgreSQL

### Option 1: Direct Connection (CLI)

```bash
# Connect to database
docker-compose exec postgres psql -U postgres -d inventory_db_dev
```

Inside `psql` prompt (`inventory_db_dev=#`), run commands below.

### Option 2: One-Command Execution

Run commands without entering psql:

```bash
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "COMMAND_HERE"
```

## Verify Tables

### List All Tables

```bash
# In psql
\dt

# Or one-command
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "\dt"
```

Expected output shows all 12+ tables created by migrations.

### Check Specific Table

```bash
# View table structure
\d shops
\d users
\d products
\d orders

# Or one-command
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "\d shops"
```

## Verify Migrations Table

```bash
# Check migration history
SELECT * FROM migrations;

# Or one-command
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "SELECT * FROM migrations;"
```

Shows all executed migrations with timestamps.

## Count Records in Tables

```bash
# Count users
SELECT COUNT(*) FROM users;

# Count products
SELECT COUNT(*) FROM products;

# Count all tables
SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public';
```

## Common psql Commands

```
\dt                 - List all tables
\d <table>          - Show table structure
\q                  - Exit psql
\h SELECT           - Help for SQL command
\c <database>       - Switch database
```

## Exit psql

```bash
\q
```

## Next Step

✅ All tables created? → [Phase 4: pgAdmin Setup](./04-pgadmin-setup.md)

(Or skip pgAdmin if CLI is enough for you)
