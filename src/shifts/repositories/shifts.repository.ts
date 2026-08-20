import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { ShopOpeningHours } from '../entities/opening-hours.entity';

export interface OpeningHourInsert {
  weekday: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

@Injectable()
export class ShiftsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The stored week, ordered so the caller can fill gaps by index without
   * sorting again. May return fewer than 7 rows — a shop that has never saved
   * its hours has none at all.
   *
   * Times come back as `pg` renders `TIME`, i.e. `'08:00:00'`.
   */
  findOpeningHours(shopId: number): Promise<ShopOpeningHours[]> {
    return this.db.query<ShopOpeningHours>(
      `SELECT shop_id, weekday, open_time::text, close_time::text, is_closed
         FROM shop_opening_hours
        WHERE shop_id = $1
        ORDER BY weekday ASC`,
      [shopId],
    );
  }

  /**
   * Writes all seven days in one statement.
   *
   * Upsert rather than delete-then-insert: there is no instant where the shop
   * has no opening hours, so a concurrent read can never see a half-written
   * week. The primary key `(shop_id, weekday)` is what makes the conflict
   * target exact.
   */
  async replaceOpeningHours(
    shopId: number,
    days: OpeningHourInsert[],
    client: pg.PoolClient,
  ): Promise<void> {
    const params: unknown[] = [shopId];
    const rows = days.map((day, i) => {
      params.push(day.weekday, day.openTime, day.closeTime, day.isClosed);
      const base = i * 4;
      return `($1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });

    await client.query(
      `INSERT INTO shop_opening_hours (shop_id, weekday, open_time, close_time, is_closed)
       VALUES ${rows.join(', ')}
       ON CONFLICT (shop_id, weekday) DO UPDATE
         SET open_time  = EXCLUDED.open_time,
             close_time = EXCLUDED.close_time,
             is_closed  = EXCLUDED.is_closed`,
      params,
    );
  }

  async findTimezone(shopId: number): Promise<string | null> {
    const row = await this.db.queryOne<{ timezone: string }>(
      `SELECT timezone FROM shops WHERE id = $1`,
      [shopId],
    );
    return row?.timezone ?? null;
  }

  async updateTimezone(shopId: number, timezone: string, client: pg.PoolClient): Promise<void> {
    await client.query(`UPDATE shops SET timezone = $2 WHERE id = $1`, [shopId, timezone]);
  }
}
