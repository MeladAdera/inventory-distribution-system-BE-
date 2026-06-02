# Docker Setup Guide

This guide will help you set up the Inventory Management System using Docker.

## Prerequisites

- Docker (v20+)
- Docker Compose (v2+)

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/MeladAdera/inventory-distribution-system-BE-.git
   cd inventory-distribution-system-BE-
   ```

2. **Build and start containers**
   ```bash
   docker-compose up -d
   ```

3. **Run migrations**
   ```bash
   docker-compose exec app npm run migrate
   ```

4. **Verify the setup**
   - API: http://localhost:3000
   - PostgreSQL: localhost:5432
   - PgAdmin: http://localhost:5050

## Services

### PostgreSQL (postgres)
- **Port**: 5432
- **User**: postgres
- **Password**: postgres
- **Database**: inventory_db_dev
- **Volume**: postgres_data (persists data)

### PgAdmin
- **Port**: 5050
- **Email**: admin@example.com
- **Password**: admin

### Application (app)
- **Port**: 3000
- **Language**: Node.js (TypeScript)
- **Framework**: NestJS 10

## Common Commands

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f app

# Execute commands in container
docker-compose exec app npm run build

# Rebuild images
docker-compose build --no-cache
```

## Database Connection

Inside containers, use:
```
postgresql://postgres:postgres@postgres:5432/inventory_db_dev
```

From your local machine:
```
postgresql://postgres:postgres@localhost:5432/inventory_db_dev
```

## Troubleshooting

### Port Already in Use
```bash
# Free up the port or use a different one in docker-compose.yml
docker-compose down
```

### Database Connection Issues
```bash
# Check PostgreSQL logs
docker-compose logs postgres

# Verify PostgreSQL is running
docker-compose ps
```

### Clear Everything and Start Fresh
```bash
docker-compose down -v  # Remove volumes
docker-compose up -d    # Start fresh
```
