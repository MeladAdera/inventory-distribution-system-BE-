# Docker & Database Migration Setup

This project uses **Docker** with **PostgreSQL** and **SQL-based migrations** (no TypeORM ORM).

## Quick Start with Docker

### 1. Build and Start Services

```bash
# Start PostgreSQL and App
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f app
```

### 2. Verify Setup

```bash
# Test API
curl http://localhost:3000/health
# Response: {"status":"ok"}

# Check database
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "\dt"
```

### 3. Stop Services

```bash
docker-compose down

# Remove volumes (delete database)
docker-compose down -v
```

---

## Database Migrations

Migrations are SQL files stored in `src/migrations/` that define your database schema.

### Migration Files

```
src/migrations/
├── 00-CreateShopsAndUsers.sql
├── 01-CreateProductsAndCategories.sql
├── 02-CreateInventorySystem.sql
├── 03-CreateOrdersSystem.sql
├── 04-CreateWalletAndNotifications.sql
└── runner.ts  (Migration executor)
```

### Running Migrations

**Automatic (via Docker):**
```bash
docker-compose up
# Migrations run automatically on startup
```

**Manual:**
```bash
npm run migration:run
```

**Local Development (without Docker):**
```bash
# Create and run PostgreSQL locally
createdb inventory_db_dev

# Run migrations
npm run migration:run
```

### Creating New Migrations

```bash
# Method 1: Automatic
npm run migration:create CreateUsersTable
# Creates: src/migrations/{TIMESTAMP}-CreateUsersTable.sql

# Method 2: Manual
# Create file: src/migrations/{timestamp}-{description}.sql
# Add SQL: CREATE TABLE users (...)
```

### Example Migration File

```sql
-- src/migrations/1717346400000-CreateShopsAndUsers.sql

CREATE TABLE shops (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_shop_id ON users(shop_id);
```

---

## Using Database in Your Code

### DatabaseService

Inject `DatabaseService` to execute queries:

```typescript
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ShopsService {
  constructor(private db: DatabaseService) {}

  async getShop(id: number) {
    return this.db.queryOne(
      'SELECT * FROM shops WHERE id = $1',
      [id],
    );
  }

  async createShop(name: string, address: string) {
    return this.db.queryOne(
      'INSERT INTO shops (name, address) VALUES ($1, $2) RETURNING *',
      [name, address],
    );
  }

  async updateShop(id: number, data: any) {
    return this.db.execute(
      'UPDATE shops SET name = $1, address = $2 WHERE id = $3',
      [data.name, data.address, id],
    );
  }
}
```

### Available Methods

```typescript
// Get multiple rows
const rows = await this.db.query('SELECT * FROM shops');

// Get single row
const shop = await this.db.queryOne('SELECT * FROM shops WHERE id = $1', [1]);

// Execute (INSERT, UPDATE, DELETE)
await this.db.execute('DELETE FROM shops WHERE id = $1', [1]);

// Transaction
await this.db.transaction(async (client) => {
  await client.query('INSERT INTO users VALUES ...');
  await client.query('INSERT INTO notifications VALUES ...');
  // Auto-commits if no error, rolls back on error
});
```

---

## Troubleshooting

### Port Already in Use

```bash
# Kill existing process on port 5432
sudo lsof -ti:5432 | xargs kill -9

# Or use different port in .env
DATABASE_PORT=5433
docker-compose up
```

### Database Connection Failed

```bash
# Check if PostgreSQL is running
docker-compose ps

# View PostgreSQL logs
docker-compose logs postgres

# Restart services
docker-compose restart
```

### Migrations Not Running

```bash
# Check migrations table
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "SELECT * FROM migrations;"

# Run migrations manually
docker-compose exec app npm run migration:run
```

### Reset Database

```bash
# Delete all data and start fresh
docker-compose down -v
docker-compose up -d

# Or just delete tables
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

---

## Environment Setup

Create `.env.development` with database credentials:

```env
NODE_ENV=development
PORT=3000
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=inventory_db_dev
JWT_SECRET=dev-secret
JWT_EXPIRATION=86400
```

**Docker Note:** The app service uses `postgres` as hostname (Docker network), not `localhost`.

---

## Development Workflow

1. **Create migration** when schema changes:
   ```bash
   npm run migration:create AddProductTable
   # Edit src/migrations/{timestamp}-AddProductTable.sql
   ```

2. **Run migrations**:
   ```bash
   npm run migration:run
   ```

3. **Use DatabaseService** in your code:
   ```typescript
   const rows = await this.db.query('SELECT * FROM products');
   ```

4. **Test locally** before pushing:
   ```bash
   docker-compose up -d
   npm test
   ```

---

## Database Schema

Currently migrated tables:

- **shops** - Shop information and wallet balance
- **users** - Users with roles (OWNER, EMPLOYEE, CLIENT_ADMIN)
- **categories** - Product categories per shop
- **products** - Global product catalog
- **shop_products** - Shop access to products (warehouse/local)
- **inventory** - Current stock levels
- **inventory_movements** - Stock transaction history
- **orders** - Purchase orders
- **order_items** - Order line items
- **wallets** - Shop payment wallets
- **wallet_transactions** - Wallet transaction history
- **notifications** - User notifications

View full ERD in project root or in DOCKER_SETUP.md.

---

## Best Practices

✅ **DO:**
- Use parameterized queries ($1, $2, etc.) - prevents SQL injection
- Create indexes for frequently queried columns
- Use foreign keys to maintain data integrity
- Document migration purpose in SQL comments
- Test migrations locally before deploying
- Keep migrations small and focused

❌ **DON'T:**
- Concatenate user input into SQL strings
- Drop tables in production migrations
- Make large schema changes without testing
- Skip migration versioning
- Run raw SQL without validation

---

## References

- PostgreSQL: https://www.postgresql.org/docs/
- Docker Compose: https://docs.docker.com/compose/
- Connection Pooling: https://node-postgres.com/features/pooling
