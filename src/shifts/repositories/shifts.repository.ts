import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { ShopOpeningHours } from '../entities/opening-hours.entity';
import { ShiftAssignee, ShiftTemplate } from '../entities/shift-template.entity';

export interface OpeningHourInsert {
  weekday: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface ShiftTemplateInsert {
  weekday: number;
  slotIndex: number;
  name: string;
  startTime: string;
  endTime: string;
}

export interface ShiftTemplatePatch {
  name?: string;
  startTime?: string;
  endTime?: string;
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

  /** One weekday's hours, for the rule checks. Null when never saved. */
  findOpeningHoursForDay(
    shopId: number,
    weekday: number,
    client?: pg.PoolClient,
  ): Promise<ShopOpeningHours | null> {
    const sql = `SELECT shop_id, weekday, open_time::text, close_time::text, is_closed
                   FROM shop_opening_hours
                  WHERE shop_id = $1 AND weekday = $2`;
    const params = [shopId, weekday];

    return client
      ? client.query<ShopOpeningHours>(sql, params).then((r) => r.rows[0] ?? null)
      : this.db.queryOne<ShopOpeningHours>(sql, params);
  }

  /**
   * Serializes every template write for one shop.
   *
   * Slot indexes are chosen by reading the day's occupied positions and taking
   * the lowest free one — a read-then-write that two concurrent requests would
   * both pass with the same answer. Locking the shop row makes the pair
   * sequential, so the second request sees the first one's slot and picks the
   * next, instead of being rejected by the unique index for a request that was
   * perfectly valid.
   */
  async lockShop(shopId: number, client: pg.PoolClient): Promise<void> {
    await client.query(`SELECT id FROM shops WHERE id = $1 FOR UPDATE`, [shopId]);
  }

  /**
   * Every live slot in the week with its rota, ordered as the owner's grid
   * reads. One query rather than a roster lookup per slot.
   *
   * The join to `users` filters on `is_active`, so an employee deactivated in
   * the users module drops off every roster immediately. Nothing there knows
   * to clean up assignments, and a name on a grid for someone who no longer
   * works here is worse than a slot that reads as empty.
   */
  findTemplates(shopId: number): Promise<(ShiftTemplate & { assignees: ShiftAssignee[] })[]> {
    return this.db.query<ShiftTemplate & { assignees: ShiftAssignee[] }>(
      `SELECT t.id, t.shop_id, t.weekday, t.slot_index, t.name,
              t.start_time::text, t.end_time::text, t.is_active, t.created_at, t.updated_at,
              COALESCE(
                JSON_AGG(JSON_BUILD_OBJECT('id', u.id, 'name', u.name) ORDER BY u.name ASC)
                  FILTER (WHERE u.id IS NOT NULL),
                '[]'
              ) AS assignees
         FROM shift_templates t
         LEFT JOIN shift_assignments a ON a.shift_template_id = t.id
         LEFT JOIN users u ON u.id = a.user_id AND u.is_active
        WHERE t.shop_id = $1 AND t.is_active
        GROUP BY t.id
        ORDER BY t.weekday ASC, t.slot_index ASC`,
      [shopId],
    );
  }

  /** One slot's rota. Same active-user filter as the grid query. */
  findAssignees(templateId: number, client?: pg.PoolClient): Promise<ShiftAssignee[]> {
    const sql = `SELECT u.id, u.name
                   FROM shift_assignments a
                   JOIN users u ON u.id = a.user_id AND u.is_active
                  WHERE a.shift_template_id = $1
                  ORDER BY u.name ASC`;

    return client
      ? client.query<ShiftAssignee>(sql, [templateId]).then((r) => r.rows)
      : this.db.query<ShiftAssignee>(sql, [templateId]);
  }

  /**
   * Swaps a slot's whole rota. Delete then insert inside the caller's
   * transaction, so no reader ever observes the empty moment between the two.
   */
  async replaceAssignees(
    templateId: number,
    userIds: number[],
    client: pg.PoolClient,
  ): Promise<void> {
    await client.query(`DELETE FROM shift_assignments WHERE shift_template_id = $1`, [templateId]);

    if (userIds.length === 0) return;

    const rows = userIds.map((_, i) => `($1, $${i + 2})`);
    await client.query(
      `INSERT INTO shift_assignments (shift_template_id, user_id) VALUES ${rows.join(', ')}`,
      [templateId, ...userIds],
    );
  }

  /** The live slots of one weekday — the siblings an overlap check runs against. */
  findTemplatesForDay(
    shopId: number,
    weekday: number,
    client: pg.PoolClient,
  ): Promise<ShiftTemplate[]> {
    return client
      .query<ShiftTemplate>(
        `SELECT id, shop_id, weekday, slot_index, name,
                start_time::text, end_time::text, is_active, created_at, updated_at
           FROM shift_templates
          WHERE shop_id = $1 AND weekday = $2 AND is_active
          ORDER BY slot_index ASC`,
        [shopId, weekday],
      )
      .then((r) => r.rows);
  }

  /** Scoped to the shop, so another shop's slot is indistinguishable from a missing one. */
  findTemplateById(
    id: number,
    shopId: number,
    client?: pg.PoolClient,
  ): Promise<ShiftTemplate | null> {
    const sql = `SELECT id, shop_id, weekday, slot_index, name,
                        start_time::text, end_time::text, is_active, created_at, updated_at
                   FROM shift_templates
                  WHERE id = $1 AND shop_id = $2 AND is_active`;
    const params = [id, shopId];

    return client
      ? client.query<ShiftTemplate>(sql, params).then((r) => r.rows[0] ?? null)
      : this.db.queryOne<ShiftTemplate>(sql, params);
  }

  async insertTemplate(
    shopId: number,
    template: ShiftTemplateInsert,
    client: pg.PoolClient,
  ): Promise<ShiftTemplate> {
    const result = await client.query<ShiftTemplate>(
      `INSERT INTO shift_templates (shop_id, weekday, slot_index, name, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, shop_id, weekday, slot_index, name,
                 start_time::text, end_time::text, is_active, created_at, updated_at`,
      [shopId, template.weekday, template.slotIndex, template.name, template.startTime, template.endTime],
    );
    return result.rows[0];
  }

  /**
   * Patches only the fields present. COALESCE keeps an omitted field at its
   * stored value, so a rename never has to resend the times it did not touch.
   */
  async updateTemplate(
    id: number,
    shopId: number,
    patch: ShiftTemplatePatch,
    client: pg.PoolClient,
  ): Promise<ShiftTemplate | null> {
    const result = await client.query<ShiftTemplate>(
      `UPDATE shift_templates
          SET name       = COALESCE($3, name),
              start_time = COALESCE($4::time, start_time),
              end_time   = COALESCE($5::time, end_time),
              updated_at = NOW()
        WHERE id = $1 AND shop_id = $2 AND is_active
        RETURNING id, shop_id, weekday, slot_index, name,
                  start_time::text, end_time::text, is_active, created_at, updated_at`,
      [id, shopId, patch.name ?? null, patch.startTime ?? null, patch.endTime ?? null],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Retires a slot rather than deleting it, so a session recorded against this
   * template keeps naming the shift it was worked under. The partial unique
   * index frees the slot position for reuse the moment this lands.
   */
  async deactivateTemplate(id: number, shopId: number, client: pg.PoolClient): Promise<boolean> {
    const result = await client.query(
      `UPDATE shift_templates
          SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1 AND shop_id = $2 AND is_active`,
      [id, shopId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
