import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { Customer, CustomerListItem } from '../entities/customer.entity';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import { UpdateCustomerDto } from '../dto/update-customer.dto';
import { CustomerQueryDto } from '../dto/customer-query.dto';

@Injectable()
export class CustomersRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(shopId: number, dto: CreateCustomerDto): Promise<Customer> {
    const rows = await this.db.query<Customer>(
      `INSERT INTO customers (shop_id, name, phone, note)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [shopId, dto.name, dto.phone ?? null, dto.note ?? null],
    );
    return rows[0];
  }

  findById(id: number): Promise<Customer | null> {
    return this.db.queryOne<Customer>('SELECT * FROM customers WHERE id = $1', [id]);
  }

  /**
   * Scoped by shop so a customer id from another shop reads as not-found rather
   * than leaking that it exists.
   */
  findByIdInShop(id: number, shopId: number): Promise<Customer | null> {
    return this.db.queryOne<Customer>(
      'SELECT * FROM customers WHERE id = $1 AND shop_id = $2',
      [id, shopId],
    );
  }

  /**
   * Only checks active rows: the unique index is scoped to `is_active = TRUE`,
   * so a deactivated customer's phone is genuinely free to reuse.
   */
  findActiveByPhone(shopId: number, phone: string, excludeId?: number): Promise<Customer | null> {
    return this.db.queryOne<Customer>(
      `SELECT * FROM customers
       WHERE shop_id = $1 AND phone = $2 AND is_active = TRUE
         AND ($3::int IS NULL OR id <> $3)`,
      [shopId, phone, excludeId ?? null],
    );
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    let idx = 2;

    if (dto.name !== undefined) {
      sets.push(`name = $${idx++}`);
      params.push(dto.name);
    }
    if (dto.phone !== undefined) {
      sets.push(`phone = $${idx++}`);
      params.push(dto.phone);
    }
    if (dto.note !== undefined) {
      sets.push(`note = $${idx++}`);
      params.push(dto.note);
    }

    if (sets.length === 0) return this.findById(id);

    sets.push('updated_at = NOW()');

    const rows = await this.db.query<Customer>(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  /** Soft delete — the row stays so its debt history is never orphaned. */
  async deactivate(id: number): Promise<Customer | null> {
    const rows = await this.db.query<Customer>(
      `UPDATE customers SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND is_active = TRUE
       RETURNING *`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Money that stops a customer from being deactivated: debts still owed, and
   * cancelled debts whose collected money has to go back. Both would become
   * invisible if the customer disappeared from the active list.
   */
  async hasBlockingDebt(customerId: number, client?: pg.PoolClient): Promise<boolean> {
    const sql = `SELECT 1 FROM debts
                 WHERE customer_id = $1
                   AND (status IN ('OPEN', 'PARTIAL') OR (status = 'CANCELLED' AND paid_amount > 0))
                 LIMIT 1`;

    const rows = client
      ? (await client.query(sql, [customerId])).rows
      : await this.db.query(sql, [customerId]);

    return rows.length > 0;
  }

  async findPaginated(
    shopId: number,
    query: CustomerQueryDto,
  ): Promise<{ data: CustomerListItem[]; total: number }> {
    const conditions = ['c.shop_id = $1'];
    const params: unknown[] = [shopId];
    let idx = 2;

    if (!query.includeInactive) {
      conditions.push('c.is_active = TRUE');
    }

    if (query.search) {
      conditions.push(`(c.name ILIKE $${idx} OR c.phone ILIKE $${idx})`);
      params.push(`%${query.search}%`);
      idx++;
    }

    // Aggregated over non-cancelled debts only, so a cancelled sale does not
    // keep showing as money owed.
    const havingClause = query.hasDebt
      ? `HAVING COALESCE(SUM(d.total_amount - d.paid_amount) FILTER (WHERE d.status IN ('OPEN', 'PARTIAL')), 0) > 0`
      : '';

    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx;

    const rows = await this.db.query<CustomerListItem & { total_count: string }>(
      `SELECT c.*,
              COUNT(d.id) FILTER (WHERE d.status IN ('OPEN', 'PARTIAL'))::int AS open_debts_count,
              COALESCE(SUM(d.total_amount - d.paid_amount)
                       FILTER (WHERE d.status IN ('OPEN', 'PARTIAL')), 0)::text AS total_remaining,
              COUNT(*) OVER() AS total_count
       FROM customers c
       LEFT JOIN debts d ON d.customer_id = c.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY c.id
       ${havingClause}
       ORDER BY c.name ASC, c.id ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as CustomerListItem),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }
}
