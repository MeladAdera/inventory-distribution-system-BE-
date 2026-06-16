import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as pg from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor() {
    const isProd = process.env.NODE_ENV === 'production';

    this.pool = new pg.Pool({
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
      user: process.env.DATABASE_USERNAME,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      // Keep connections bounded so the app fails fast under unexpected load
      // rather than exhausting the DB.
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: isProd ? { rejectUnauthorized: true } : false,
    });
  }

  async query<T extends pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    const client = await this.pool.connect();

    try {
      const result = await client.query<T>(sql, params ? [...params] : undefined);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async queryOne<T extends pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    void (await this.query(sql, params));
  }

  async transaction<T>(
    callback: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const result = await callback(client);

      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
