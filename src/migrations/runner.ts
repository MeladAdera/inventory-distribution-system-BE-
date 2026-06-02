import * as fs from 'fs';
import * as path from 'path';
import * as pg from 'pg';

interface Migration {
  name: string;
  content: string;
}

const pool = new pg.Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  user: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'inventory_db_dev',
});

async function createMigrationsTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    client.release();
  }
}

async function getMigrations(): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ name: string }>(
      'SELECT name FROM migrations ORDER BY name',
    );
    return result.rows.map((row) => row.name);
  } finally {
    client.release();
  }
}

function readMigrationFiles(): Migration[] {
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir).filter((file) => {
    return file.endsWith('.sql') && !file.startsWith('.');
  });

  return files.map((file) => ({
    name: file,
    content: fs.readFileSync(path.join(migrationsDir, file), 'utf-8'),
  }));
}

async function runMigrations(): Promise<void> {
  try {
    await createMigrationsTable();
    const executedMigrations = await getMigrations();
    const allMigrations = readMigrationFiles();

    for (const migration of allMigrations) {
      if (executedMigrations.includes(migration.name)) {
        console.log(`⏭️  Skipping ${migration.name} (already executed)`);
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.content);
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [migration.name],
        );
        await client.query('COMMIT');
        console.log(`✅ Executed ${migration.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed to execute ${migration.name}:`, error);
        throw error;
      } finally {
        client.release();
      }
    }

    console.log('✨ All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void runMigrations();
