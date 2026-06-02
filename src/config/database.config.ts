// Database configuration for PostgreSQL
// No ORM - using raw SQL with pg library
// Migrations are managed via src/migrations/runner.ts

export const databaseConfig = {
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  user: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'inventory_db_dev',
};
