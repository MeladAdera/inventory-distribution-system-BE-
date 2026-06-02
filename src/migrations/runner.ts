import * as fs from 'fs';
import * as path from 'path';
import * as pg from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({
  path: `.env.${process.env.NODE_ENV || 'development'}`,
});

const client = new pg.Client({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  user: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'inventory_db_dev',
});

interface Migration {
  name: string;
  timestamp: number;
}

async function createMigrationsTable(): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      timestamp BIGINT NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getMigrations(): Promise<Migration[]> {
  const result = await client.query<Migration>(
    'SELECT name, timestamp FROM migrations ORDER BY timestamp ASC',
  );

  return result.rows;
}

async function runMigration(file: string): Promise<void> {
  const filePath = path.join(__dirname, file);
  const sql = fs.readFileSync(filePath, 'utf-8');
  const timestamp = parseInt(file.match(/(\d+)-/)?.[1] ?? '0', 10);

  console.log(`Running migration: ${file}`);

  await client.query(sql);

  await client.query(
    'INSERT INTO migrations (name, timestamp) VALUES ($1, $2)',
    [file, timestamp],
  );

  console.log(`✓ Migration ${file} completed`);
}

async function runPendingMigrations(): Promise<void> {
  try {
    await client.connect();
    console.log('Connected to database');

    await createMigrationsTable();

    const executedMigrations = await getMigrations();
    const executedNames = executedMigrations.map((migration) => migration.name);

    const migrationFiles = fs
      .readdirSync(__dirname)
      .filter(
        (file) =>
          file.endsWith('.sql') &&
          !file.includes('runner') &&
          !file.includes('rollback'),
      )
      .sort();

    const pendingMigrations = migrationFiles.filter(
      (file) => !executedNames.includes(file),
    );

    if (pendingMigrations.length === 0) {
      console.log('No pending migrations');
      return;
    }

    console.log(`Found ${pendingMigrations.length} pending migrations`);

    for (const file of pendingMigrations) {
      await runMigration(file);
    }

    console.log('All migrations completed successfully');
  } catch (error: unknown) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run if executed directly
if (require.main === module) {
  void runPendingMigrations();
}

export { runPendingMigrations };
