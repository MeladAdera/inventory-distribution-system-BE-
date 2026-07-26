import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import {
  Debt,
  DebtSource,
  DebtorType,
  DebtListItem,
  DebtsSummary,
  DebtsAgingRow,
  AgingBucket,
  AGING_BUCKETS,
} from '../entities/debt.entity';
import { DebtPayment, PaymentMethod } from '../entities/debt-payment.entity';
import { DebtQueryDto } from '../dto/debt-query.dto';

/**
 * What the caller is allowed to see, resolved from their role before the query
 * runs. Kept separate from `DebtQueryDto` so a user-supplied filter can never
 * widen the scope — visibility is ANDed on top of the filters.
 */
export interface DebtVisibility {
  /** Non-admins only see debts their shop is a party to (either side). */
  shopId?: number;
  /** Employees are limited to customer debts (see the role matrix). */
  forceDebtorType?: DebtorType;
}

export interface InsertDebtRow {
  creditorShopId: number;
  debtorType: DebtorType;
  debtorShopId: number | null;
  customerId: number | null;
  orderId: number | null;
  receiptId: number | null;
  /** DECIMAL(15,2) string — see money.util.ts. */
  totalAmount: string;
  createdBy: number;
  note: string | null;
  dueDate: string | null;
}

export interface InsertPaymentRow {
  debtId: number;
  /** Positive for a collection, negative for a reversal. */
  amount: string;
  method: PaymentMethod;
  isReversal: boolean;
  reversesPaymentId: number | null;
  note: string | null;
  createdBy: number;
}

// The source document lives in one of two columns. Mapping a closed union to a
// column name keeps the dynamic fragment out of reach of user input.
const SOURCE_COLUMN: Record<DebtSource['type'], string> = {
  ORDER: 'order_id',
  RECEIPT: 'receipt_id',
};

/**
 * The age test per bucket, written once. The aging report's CASE and the
 * `?agingBucket=` list filter are both built from this map, so the total in a
 * bucket always matches the rows you get when you click into it.
 *
 * The conditions are mutually exclusive and cover all ages, and they are static
 * SQL selected by a validated enum — no user input reaches the fragment.
 */
const AGING_CONDITION: Record<AgingBucket, string> = {
  '0-30': `NOW() - d.created_at < INTERVAL '30 days'`,
  '31-60': `NOW() - d.created_at >= INTERVAL '30 days' AND NOW() - d.created_at < INTERVAL '60 days'`,
  '60+': `NOW() - d.created_at >= INTERVAL '60 days'`,
};

const AGING_CASE = `CASE ${AGING_BUCKETS.map(
  (bucket) => `WHEN ${AGING_CONDITION[bucket]} THEN '${bucket}'`,
).join(' ')} ELSE '60+' END`;

// Aging only counts money still collectable. PAID debts are settled and
// CANCELLED ones are not receivable — neither belongs in a "who owes me" report.
const UNSETTLED = `d.status IN ('OPEN', 'PARTIAL')`;

@Injectable()
export class DebtsRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(row: InsertDebtRow, client: pg.PoolClient): Promise<Debt> {
    const result = await client.query<Debt>(
      `INSERT INTO debts (
         creditor_shop_id, debtor_type, debtor_shop_id, customer_id,
         order_id, receipt_id, total_amount, created_by, note, due_date
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        row.creditorShopId,
        row.debtorType,
        row.debtorShopId,
        row.customerId,
        row.orderId,
        row.receiptId,
        row.totalAmount,
        row.createdBy,
        row.note,
        row.dueDate,
      ],
    );
    return result.rows[0];
  }

  findById(id: number): Promise<Debt | null> {
    return this.db.queryOne<Debt>('SELECT * FROM debts WHERE id = $1', [id]);
  }

  /**
   * Takes a row lock for the rest of the transaction. Every write path that
   * reads `paid_amount`, decides something from it, then writes it back must
   * start here — otherwise two concurrent collections can both pass the
   * "not more than remaining" check against the same stale value.
   *
   * This is deliberately different from the conditional-`UPDATE` guard used by
   * `ReceiptsRepository.cancel`/`setIsFree`. Those flip a boolean, where
   * "somebody already did it" is a complete answer. Here the amount has to be
   * read, checked, and only then written, so a real lock is required.
   */
  async findByIdForUpdate(id: number, client: pg.PoolClient): Promise<Debt | null> {
    const result = await client.query<Debt>('SELECT * FROM debts WHERE id = $1 FOR UPDATE', [id]);
    return result.rows[0] ?? null;
  }

  /** The live (non-cancelled) debt for a source document, if any. */
  findBySource(source: DebtSource): Promise<Debt | null> {
    return this.db.queryOne<Debt>(
      `SELECT * FROM debts
       WHERE ${SOURCE_COLUMN[source.type]} = $1 AND status <> 'CANCELLED'`,
      [source.id],
    );
  }

  /**
   * Includes cancelled rows, so a caller that found no live debt can tell
   * "this sale was voided" apart from "this sale was never on credit" and
   * report the accurate reason. Newest first — a source may be re-billed after
   * a cancellation.
   */
  findAnyBySource(source: DebtSource): Promise<Debt | null> {
    return this.db.queryOne<Debt>(
      `SELECT * FROM debts
       WHERE ${SOURCE_COLUMN[source.type]} = $1
       ORDER BY id DESC
       LIMIT 1`,
      [source.id],
    );
  }

  /**
   * Applies a signed delta to `paid_amount` and re-derives `status` from the
   * result, so status can never disagree with the amount.
   *
   * The addition happens in Postgres `numeric`, not in JS — the service only
   * ever hands over a validated 2-decimal string.
   *
   * `>= total_amount` rather than `=` is defensive: `chk_debts_paid_not_over`
   * already rejects an overpay, so the two are equivalent, but this way a
   * rounding surprise would land on PAID instead of silently staying PARTIAL.
   */
  async applyPaymentDelta(id: number, delta: string, client: pg.PoolClient): Promise<Debt> {
    const result = await client.query<Debt>(
      `UPDATE debts
       SET paid_amount = paid_amount + $2::numeric,
           status = CASE
             WHEN paid_amount + $2::numeric >= total_amount THEN 'PAID'
             WHEN paid_amount + $2::numeric > 0             THEN 'PARTIAL'
             ELSE 'OPEN'
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, delta],
    );
    return result.rows[0];
  }

  /**
   * Conditional on the debt not already being cancelled, so a source document
   * cancelled twice produces exactly one cancellation. Returns null when there
   * was no live debt — a fully-paid or never-indebted order is not an error.
   */
  async cancelBySource(source: DebtSource, client: pg.PoolClient): Promise<Debt | null> {
    const result = await client.query<Debt>(
      `UPDATE debts
       SET status = 'CANCELLED', updated_at = NOW()
       WHERE ${SOURCE_COLUMN[source.type]} = $1 AND status <> 'CANCELLED'
       RETURNING *`,
      [source.id],
    );
    return result.rows[0] ?? null;
  }

  async insertPayment(row: InsertPaymentRow, client: pg.PoolClient): Promise<DebtPayment> {
    const result = await client.query<DebtPayment>(
      `INSERT INTO debt_payments (
         debt_id, amount, method, is_reversal, reverses_payment_id, note, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [row.debtId, row.amount, row.method, row.isReversal, row.reversesPaymentId, row.note, row.createdBy],
    );
    return result.rows[0];
  }

  /** Scoped by debt_id so a payment id from another debt reads as not-found. */
  async findPaymentById(
    paymentId: number,
    debtId: number,
    client: pg.PoolClient,
  ): Promise<DebtPayment | null> {
    const result = await client.query<DebtPayment>(
      'SELECT * FROM debt_payments WHERE id = $1 AND debt_id = $2',
      [paymentId, debtId],
    );
    return result.rows[0] ?? null;
  }

  async findReversalOf(paymentId: number, client: pg.PoolClient): Promise<DebtPayment | null> {
    const result = await client.query<DebtPayment>(
      'SELECT * FROM debt_payments WHERE reverses_payment_id = $1',
      [paymentId],
    );
    return result.rows[0] ?? null;
  }

  findPaymentsByDebtId(debtId: number): Promise<DebtPayment[]> {
    return this.db.query<DebtPayment>(
      'SELECT * FROM debt_payments WHERE debt_id = $1 ORDER BY paid_at ASC, id ASC',
      [debtId],
    );
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  async findPaginated(
    query: DebtQueryDto,
    visibility: DebtVisibility,
  ): Promise<{ data: DebtListItem[]; total: number }> {
    const { conditions, params, nextIdx } = this.buildFilters(query, visibility);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(query.limit, query.offset);

    const rows = await this.db.query<DebtListItem & { total_count: string }>(
      `SELECT d.*,
              (d.total_amount - d.paid_amount)::numeric(15,2)::text AS remaining,
              -- One name column regardless of which side of the union is set,
              -- so the list UI does not have to branch on debtor_type.
              COALESCE(ds.name, c.name) AS debtor_name,
              cs.name                   AS creditor_shop_name,
              COUNT(*) OVER()           AS total_count
       FROM debts d
       JOIN shops          cs ON cs.id = d.creditor_shop_id
       LEFT JOIN shops     ds ON ds.id = d.debtor_shop_id
       LEFT JOIN customers c  ON c.id  = d.customer_id
       ${whereClause}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as DebtListItem),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  /**
   * The customer's unsettled debts, oldest first, locked for the transaction.
   *
   * `ORDER BY created_at, id` is a total order, and every caller acquires the
   * locks in it — that is what stops two cashiers collecting from the same
   * customer at once from deadlocking against each other. It is also the FIFO
   * order the allocation walks, so one query serves both purposes.
   */
  async findOpenByCustomerForUpdate(customerId: number, client: pg.PoolClient): Promise<Debt[]> {
    const result = await client.query<Debt>(
      `SELECT * FROM debts
       WHERE customer_id = $1 AND status IN ('OPEN', 'PARTIAL')
       ORDER BY created_at ASC, id ASC
       FOR UPDATE`,
      [customerId],
    );
    return result.rows;
  }

  getSummaryForCustomer(customerId: number): Promise<DebtsSummary> {
    return this.runSummary('WHERE d.customer_id = $1', [customerId]);
  }

  /**
   * How much is owed, grouped by how long it has been owed.
   *
   * Sums the *remaining* balance, not the original sale value — a 100.00 sale
   * with 90.00 collected is 10.00 of exposure, not 100.00.
   *
   * Buckets with nothing in them are absent from the result; the service fills
   * them back in so the response shape is stable for a chart.
   */
  async getAging(query: DebtQueryDto, visibility: DebtVisibility): Promise<DebtsAgingRow[]> {
    const { conditions, params } = this.buildFilters(query, visibility);
    const where = [UNSETTLED, ...conditions].join(' AND ');

    return this.db.query<DebtsAgingRow>(
      `SELECT ${AGING_CASE}                                    AS bucket,
              COUNT(*)::int                                    AS count,
              SUM(d.total_amount - d.paid_amount)::numeric(15,2)::text AS amount
       FROM debts d
       WHERE ${where}
       GROUP BY bucket`,
      params,
    );
  }

  getSummary(query: DebtQueryDto, visibility: DebtVisibility): Promise<DebtsSummary> {
    const { conditions, params } = this.buildFilters(query, visibility);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.runSummary(whereClause, params);
  }

  /**
   * A shop's totals for one side of the ledger: `DEBTOR` is what it owes the
   * warehouse, `CREDITOR` is what its customers owe it. Reported separately
   * rather than netted, so a shop deep in credit sales cannot look settled just
   * because it owes the warehouse a similar amount.
   */
  getSummaryForShopAs(side: 'DEBTOR' | 'CREDITOR', shopId: number): Promise<DebtsSummary> {
    const column = side === 'DEBTOR' ? 'debtor_shop_id' : 'creditor_shop_id';
    return this.runSummary(`WHERE d.${column} = $1`, [shopId]);
  }

  /**
   * Cancelled debts are excluded from billed/collected/remaining — they are not
   * receivable any more — but their collected money is reported separately as
   * `refund_due`, so it stays visible instead of vanishing from every total.
   */
  private async runSummary(whereClause: string, params: unknown[]): Promise<DebtsSummary> {
    // ::numeric(15,2) before ::text: the COALESCE fallback is an integer
    // literal, so an empty result set would otherwise serialize as "0" while a
    // populated one gives "0.00". Money must render the same either way.
    const row = await this.db.queryOne<DebtsSummary>(
      `SELECT
         COALESCE(SUM(d.total_amount)                  FILTER (WHERE d.status <> 'CANCELLED'), 0)::numeric(15,2)::text AS total_billed,
         COALESCE(SUM(d.paid_amount)                   FILTER (WHERE d.status <> 'CANCELLED'), 0)::numeric(15,2)::text AS total_collected,
         COALESCE(SUM(d.total_amount - d.paid_amount)  FILTER (WHERE d.status <> 'CANCELLED'), 0)::numeric(15,2)::text AS total_remaining,
         COUNT(*)                                      FILTER (WHERE d.status IN ('OPEN', 'PARTIAL'))::int AS open_count,
         COALESCE(SUM(d.paid_amount)                   FILTER (WHERE d.status =  'CANCELLED'), 0)::numeric(15,2)::text AS refund_due
       FROM debts d
       ${whereClause}`,
      params,
    );

    // An aggregate without GROUP BY always returns exactly one row, even over
    // an empty set — so this is never null.
    return row!;
  }

  /**
   * Visibility is applied first and unconditionally; the DTO filters can only
   * narrow what is already permitted.
   */
  private buildFilters(
    query: DebtQueryDto,
    visibility: DebtVisibility,
  ): { conditions: string[]; params: unknown[]; nextIdx: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (visibility.shopId !== undefined) {
      conditions.push(`(d.debtor_shop_id = $${idx} OR d.creditor_shop_id = $${idx})`);
      params.push(visibility.shopId);
      idx++;
    }

    if (visibility.forceDebtorType !== undefined) {
      conditions.push(`d.debtor_type = $${idx++}`);
      params.push(visibility.forceDebtorType);
    } else if (query.debtorType !== undefined) {
      conditions.push(`d.debtor_type = $${idx++}`);
      params.push(query.debtorType);
    }

    if (query.status !== undefined) {
      conditions.push(`d.status = $${idx++}`);
      params.push(query.status);
    }

    if (query.shopId !== undefined) {
      conditions.push(`d.debtor_shop_id = $${idx++}`);
      params.push(query.shopId);
    }

    if (query.customerId !== undefined) {
      conditions.push(`d.customer_id = $${idx++}`);
      params.push(query.customerId);
    }

    // Static fragment chosen by a validated enum — the same condition the aging
    // report groups by. UNSETTLED comes with it: a bucket means "unsettled money
    // of this age", so without it the drill-down would list settled and
    // cancelled debts the bucket never counted, and the rows would not add up to
    // the bar the user clicked.
    if (query.agingBucket !== undefined) {
      conditions.push(AGING_CONDITION[query.agingBucket], UNSETTLED);
    }

    if (query.fromDate) {
      conditions.push(`d.created_at >= $${idx++}`);
      params.push(query.fromDate);
    }

    if (query.toDate) {
      conditions.push(`d.created_at < ($${idx++}::date + interval '1 day')`);
      params.push(query.toDate);
    }

    return { conditions, params, nextIdx: idx };
  }
}
