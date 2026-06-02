# Phase 1: Docker Setup

Start PostgreSQL database and the NestJS app using Docker Compose.

## Prerequisites

- Docker installed
- Docker Compose installed
- `.env.development` file configured

## Steps

### 1. Verify Environment Variables

Check `.env.development` has correct database credentials:

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

### 2. Start Services

```bash
# Start PostgreSQL, App, and pgAdmin in background
docker-compose up -d
```

### 3. Check Service Status

```bash
# List all running containers
docker-compose ps
```

Expected output:
```
NAME                COMMAND             STATUS
inventory_postgres  postgres            Up (healthy)
inventory_app       npm start           Up
inventory_pgadmin   /entrypoint.sh      Up
```

### 4. View Logs (Optional)

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f postgres
docker-compose logs -f app
docker-compose logs -f pgadmin
```

## Troubleshooting

### Port Already in Use

```bash
# Kill process on port 5432
sudo lsof -ti:5432 | xargs kill -9

# Or use different port in .env
DATABASE_PORT=5433
docker-compose up -d
```

### Services Won't Start

```bash
# Restart services
docker-compose restart

# Rebuild and start
docker-compose down
docker-compose up -d --build
```

## Next Step

✅ Services running? → [Phase 2: Migrations](./02-migrations.md)

❌ Issues? Check logs above or see [Troubleshooting](./03-troubleshooting.md)
