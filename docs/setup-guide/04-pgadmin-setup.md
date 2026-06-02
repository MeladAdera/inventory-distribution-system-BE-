# Phase 4: pgAdmin Setup

Access your PostgreSQL database via the web interface using pgAdmin.

## What is pgAdmin?

pgAdmin is a powerful, open-source PostgreSQL management tool with a web interface. It provides a GUI for managing databases, tables, queries, and data.

## Prerequisites

- Docker services running ([Phase 1](./01-docker-setup.md))
- pgAdmin service started in docker-compose.yml

## Access pgAdmin

### Open in Browser

```
http://localhost:5050
```

### Login Credentials

```
Email: admin@admin.com
Password: admin
```

## Connect to Database

### Step 1: Add Server

1. In pgAdmin, right-click **"Servers"** → **"Create"** → **"Server..."**

### Step 2: General Tab

```
Name: inventory_db
```

### Step 3: Connection Tab

⚠️ **Important:** Use `postgres` as host (Docker network name), NOT `localhost`

```
Host: postgres
Port: 5432
Username: postgres
Password: postgres
Database: inventory_db_dev
Save password: ✓ (checked)
```

### Step 4: Save

Click **"Save"** button.

## Browse Tables

Once connected:

1. Expand **"Servers"** → **"inventory_db"**
2. Expand **"Databases"** → **"inventory_db_dev"**
3. Expand **"Schemas"** → **"public"**
4. Expand **"Tables"**

You'll see all tables created by migrations:
- `shops`
- `users`
- `products`
- `categories`
- `shop_products`
- `inventory`
- `inventory_movements`
- `orders`
- `order_items`
- `wallets`
- `wallet_transactions`
- `notifications`

## Common Tasks

### View Table Data

1. Right-click table → **"View/Edit Data"** → **"All Rows"**
2. Browse and edit data visually

### View Table Structure

1. Right-click table → **"Properties"**
2. See columns, types, constraints

### Run SQL Queries

1. Top menu: **"Tools"** → **"Query Tool"**
2. Write SQL and execute:

```sql
SELECT COUNT(*) FROM users;
SELECT * FROM shops;
INSERT INTO shops (name, address) VALUES ('My Shop', '123 Street');
```

### Create Backup

1. Right-click **"inventory_db_dev"** → **"Backup..."**
2. Choose format and options
3. Save backup file

## Connection Troubleshooting

### Error: Connection Refused

❌ **Wrong:** Host = `localhost` or `127.0.0.1`
✅ **Correct:** Host = `postgres` (Docker container name)

Services are in Docker, so use Docker network hostname.

### Error: Password Authentication Failed

Check credentials match `.env.development`:
```
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
```

### Server Won't Start

```bash
# Check pgAdmin is running
docker-compose ps pgadmin

# View logs
docker-compose logs pgadmin

# Restart
docker-compose restart pgadmin
```

## Keyboard Shortcuts

```
Ctrl+Enter  - Execute query
Ctrl+/      - Comment line
F5          - Refresh
```

## Documentation

- [pgAdmin Official Docs](https://www.pgadmin.org/docs/)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)

---

✅ **Setup Complete!** You can now:
- View tables and data in pgAdmin
- Run SQL queries
- Manage your database visually

---

## Going Back

- Want to use CLI instead? → [Phase 3: Verify PostgreSQL](./03-verify-postgres.md)
- Need to restart services? → [Phase 1: Docker Setup](./01-docker-setup.md)
