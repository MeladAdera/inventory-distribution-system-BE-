import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { ShopOpeningHours } from '../entities/opening-hours.entity';
import { ShiftAssignee, ShiftTemplate } from '../entities/shift-template.entity';
import { ShiftSession, ShiftSessionWithNames } from '../entities/shift-session.entity';

/** The shop's own wall clock, for deciding which slot is running right now. */
export interface ShopClock {
  /** `YYYY-MM-DD` in the shop's timezone. */
  business_date: string;
  /** 0 = Sunday, matching `Date.getDay()` and Postgres `DOW`. */
  weekday: number;
  /** Minutes since local midnight, 0..1439. */
  minutes: number;
}

/**
 * The raw components of a drawer's expected total, straight from SQL as money
 * strings. The arithmetic happens in the service through bigint minor units.
 */
export interface CashTotals {
  opening_float: string;
  cash_sales: string;
  collections: string;
  payouts: string;
}

/** A slot together with the trading window of the day it sits in. */
export interface TemplateWithHours {
  id: number;
  weekday: number;
  name: string;
  start_time: string;
  end_time: string;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

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

  // ── Sessions ───────────────────────────────────────────────────────────────

  /**
   * What time it is where the shop is. Read inside the caller's transaction so
   * it agrees exactly with the `business_date` stamped on insert: Postgres
   * `NOW()` is the transaction timestamp, so both see the same instant even if
   * the clock crosses midnight between the two statements.
   */
  async findShopClock(shopId: number, client: pg.PoolClient): Promise<ShopClock | null> {
    const result = await client.query<ShopClock>(
      `SELECT (NOW() AT TIME ZONE s.timezone)::date::text            AS business_date,
              EXTRACT(DOW FROM (NOW() AT TIME ZONE s.timezone))::int AS weekday,
              (EXTRACT(HOUR   FROM (NOW() AT TIME ZONE s.timezone)) * 60
             + EXTRACT(MINUTE FROM (NOW() AT TIME ZONE s.timezone)))::int AS minutes
         FROM shops s
        WHERE s.id = $1`,
      [shopId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Live slots on the given weekdays, each with the trading window of its own
   * day — the caller needs both to place a window that crosses midnight.
   *
   * Two weekdays are asked for at once because at 00:30 the shift still
   * running belongs to *yesterday's* trading day.
   */
  findTemplatesWithHours(
    shopId: number,
    weekdays: number[],
    client: pg.PoolClient,
  ): Promise<TemplateWithHours[]> {
    return client
      .query<TemplateWithHours>(
        `SELECT t.id, t.weekday, t.name,
                t.start_time::text, t.end_time::text,
                h.open_time::text, h.close_time::text, h.is_closed
           FROM shift_templates t
           JOIN shop_opening_hours h
             ON h.shop_id = t.shop_id AND h.weekday = t.weekday
          WHERE t.shop_id = $1 AND t.is_active AND t.weekday = ANY($2::int[])`,
        [shopId, weekdays],
      )
      .then((r) => r.rows);
  }

  async isAssignedTo(templateId: number, userId: number, client: pg.PoolClient): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM shift_assignments WHERE shift_template_id = $1 AND user_id = $2`,
      [templateId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * The shop's open shift, or null. Exactly one row can match — the partial
   * unique index guarantees it — which is what makes "which shift does this
   * sale belong to" answerable without the client saying.
   */
  findOpenSession(shopId: number, client?: pg.PoolClient): Promise<ShiftSessionWithNames | null> {
    const sql = `SELECT ss.id, ss.shop_id, ss.user_id, ss.shift_template_id,
                        ss.business_date::text, ss.opened_at, ss.closed_at, ss.closed_by,
                        ss.opening_float::text, ss.counted_cash::text,
                        ss.expected_cash::text, ss.cash_difference::text,
                        ss.is_off_schedule, ss.notes, ss.client_session_id, ss.status,
                        u.name AS user_name,
                        t.name AS shift_template_name
                   FROM shift_sessions ss
                   JOIN users u ON u.id = ss.user_id
                   LEFT JOIN shift_templates t ON t.id = ss.shift_template_id
                  WHERE ss.shop_id = $1 AND ss.status = 'OPEN'`;

    return client
      ? client.query<ShiftSessionWithNames>(sql, [shopId]).then((r) => r.rows[0] ?? null)
      : this.db.queryOne<ShiftSessionWithNames>(sql, [shopId]);
  }

  /**
   * One session by id, scoped to the shop — so a session id from another shop
   * is indistinguishable from one that does not exist. Used to check an id the
   * client supplied rather than one the server resolved.
   */
  async findSessionInShop(
    id: number,
    shopId: number,
    client?: pg.PoolClient,
  ): Promise<ShiftSession | null> {
    const sql = `SELECT id, shop_id, user_id, shift_template_id, business_date::text,
                        opened_at, closed_at, closed_by, opening_float::text,
                        counted_cash::text, expected_cash::text, cash_difference::text,
                        is_off_schedule, notes, client_session_id, status
                   FROM shift_sessions
                  WHERE id = $1 AND shop_id = $2`;

    return client
      ? client.query<ShiftSession>(sql, [id, shopId]).then((r) => r.rows[0] ?? null)
      : this.db.queryOne<ShiftSession>(sql, [id, shopId]);
  }

  /**
   * The three figures the drawer's expected total is built from, read in one
   * statement so they cannot disagree about which instant they describe.
   *
   * Every term is `numeric`, never `float8`. The receipt list elsewhere casts
   * totals to float because it is display; this number decides whether somebody
   * is short, so it stays exact and leaves as text for `toMinor`.
   */
  async findCashTotals(sessionId: number, client: pg.PoolClient): Promise<CashTotals | null> {
    const result = await client.query<CashTotals>(
      `SELECT
         s.opening_float::text AS opening_float,

         -- Sales settled entirely in cash. The NOT EXISTS is what makes a
         -- credit sale work: a sale paid in full has no debt row, so its whole
         -- total is cash, while a credit sale's cash arrived as a payment row
         -- and is counted in "collections" below. Summing both without this
         -- would report a 100-for-30 credit sale as 130 in the drawer.
         --
         -- Deliberately unfiltered by debt status: a cancelled debt still
         -- proves the sale was made on credit, and ignoring it would make a
         -- cancelled credit sale count its full total as cash.
         COALESCE((
           SELECT SUM(ri.quantity * ri.price)
             FROM receipts r
             JOIN receipt_items ri ON ri.receipt_id = r.id
            WHERE r.shift_session_id = s.id
              AND r.is_free = FALSE
              AND r.is_cancelled = FALSE
              AND NOT EXISTS (SELECT 1 FROM debts d WHERE d.receipt_id = r.id)
         ), 0)::numeric(15,2)::text AS cash_sales,

         -- Cash in from customers, including the down payment on a credit sale.
         -- No is_reversal filter anywhere here: a reversal is stored with a
         -- negative amount, so SUM already nets it out. Subtracting reversals
         -- separately would remove each one twice.
         COALESCE((
           SELECT SUM(p.amount)
             FROM debt_payments p
             JOIN debts d ON d.id = p.debt_id
            WHERE p.shift_session_id = s.id
              AND p.method = 'CASH'
              AND d.creditor_type = 'SHOP'
         ), 0)::numeric(15,2)::text AS collections,

         -- Cash out to suppliers. Customer collections and supplier payments
         -- share this table, so without the creditor_type split, paying a
         -- supplier 500 would *add* 500 to the drawer.
         COALESCE((
           SELECT SUM(p.amount)
             FROM debt_payments p
             JOIN debts d ON d.id = p.debt_id
            WHERE p.shift_session_id = s.id
              AND p.method = 'CASH'
              AND d.creditor_type = 'SUPPLIER'
         ), 0)::numeric(15,2)::text AS payouts

       FROM shift_sessions s
       WHERE s.id = $1`,
      [sessionId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Closes the shift and freezes the numbers.
   *
   * Conditional on `status = 'OPEN'`, the same guard style as cancelling a
   * receipt: two people closing at once serialize here and only the request
   * that flips the row does the work, so a drawer can never be counted twice.
   */
  async closeSession(
    id: number,
    shopId: number,
    close: {
      countedCash: string;
      expectedCash: string;
      cashDifference: string;
      closedBy: number;
      notes: string | undefined;
    },
    client: pg.PoolClient,
  ): Promise<ShiftSession | null> {
    const result = await client.query<ShiftSession>(
      `UPDATE shift_sessions
          SET status          = 'CLOSED',
              closed_at       = NOW(),
              closed_by       = $3,
              counted_cash    = $4::numeric,
              expected_cash   = $5::numeric,
              cash_difference = $6::numeric,
              notes           = $7
        WHERE id = $1 AND shop_id = $2 AND status = 'OPEN'
       RETURNING id, shop_id, user_id, shift_template_id, business_date::text,
                 opened_at, closed_at, closed_by, opening_float::text,
                 counted_cash::text, expected_cash::text, cash_difference::text,
                 is_off_schedule, notes, client_session_id, status`,
      [
        id,
        shopId,
        close.closedBy,
        close.countedCash,
        close.expectedCash,
        close.cashDifference,
        close.notes ?? null,
      ],
    );
    return result.rows[0] ?? null;
  }

  /** One session with its names resolved, open or closed. */
  findSessionWithNames(
    id: number,
    shopId: number,
    client?: pg.PoolClient,
  ): Promise<ShiftSessionWithNames | null> {
    const sql = `SELECT ss.id, ss.shop_id, ss.user_id, ss.shift_template_id,
                        ss.business_date::text, ss.opened_at, ss.closed_at, ss.closed_by,
                        ss.opening_float::text, ss.counted_cash::text,
                        ss.expected_cash::text, ss.cash_difference::text,
                        ss.is_off_schedule, ss.notes, ss.client_session_id, ss.status,
                        u.name AS user_name,
                        t.name AS shift_template_name
                   FROM shift_sessions ss
                   JOIN users u ON u.id = ss.user_id
                   LEFT JOIN shift_templates t ON t.id = ss.shift_template_id
                  WHERE ss.id = $1 AND ss.shop_id = $2`;

    return client
      ? client.query<ShiftSessionWithNames>(sql, [id, shopId]).then((r) => r.rows[0] ?? null)
      : this.db.queryOne<ShiftSessionWithNames>(sql, [id, shopId]);
  }

  /**
   * Opens a session, taking `business_date` from the shop's own timezone in the
   * same statement. Deriving it in SQL rather than in Node keeps the stamp on
   * the same clock as `opened_at`, with no window between reading the zone and
   * writing the row.
   */
  async insertSession(
    shopId: number,
    userId: number,
    shiftTemplateId: number | null,
    openingFloat: string,
    isOffSchedule: boolean,
    client: pg.PoolClient,
  ): Promise<ShiftSession> {
    const result = await client.query<ShiftSession>(
      `INSERT INTO shift_sessions
              (shop_id, user_id, shift_template_id, business_date, opening_float, is_off_schedule)
       SELECT $1, $2, $3, (NOW() AT TIME ZONE s.timezone)::date, $4::numeric, $5
         FROM shops s
        WHERE s.id = $1
       RETURNING id, shop_id, user_id, shift_template_id, business_date::text,
                 opened_at, closed_at, closed_by, opening_float::text,
                 counted_cash::text, expected_cash::text, cash_difference::text,
                 is_off_schedule, notes, client_session_id, status`,
      [shopId, userId, shiftTemplateId, openingFloat, isOffSchedule],
    );
    return result.rows[0];
  }
}
