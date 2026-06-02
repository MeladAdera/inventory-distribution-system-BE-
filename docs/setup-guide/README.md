# Setup Guide - Complete Walkthrough

This guide walks you through setting up the inventory management system with Docker, PostgreSQL, and pgAdmin.

## Phases

1. **[Docker Setup](./01-docker-setup.md)** - Start PostgreSQL and the app
2. **[Migrations](./02-migrations.md)** - Run database migrations
3. **[Verify PostgreSQL](./03-verify-postgres.md)** - Check database tables via CLI
4. **[pgAdmin Setup](./04-pgadmin-setup.md)** - Access database via web interface

## Quick Start

```bash
# Phase 1: Start Docker
docker-compose up -d

# Phase 2: Run Migrations
npm run migration:run

# Phase 3: Verify via CLI
docker-compose exec postgres psql -U postgres -d inventory_db_dev -c "\dt"

# Phase 4: Access pgAdmin
# Open browser: http://localhost:5050
```

---

**Next:** Start with [Phase 1: Docker Setup](./01-docker-setup.md)
