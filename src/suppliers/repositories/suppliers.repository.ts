import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { Supplier, SupplierListItem } from '../entities/supplier.entity';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { SupplierQueryDto } from '../dto/supplier-query.dto';

@Injectable()
export class SuppliersRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(shopId: number, dto: CreateSupplierDto): Promise<Supplier> {
    const rows = await this.db.query<Supplier>(
      `INSERT INTO suppliers (shop_id, name, phone, note)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [shopId, dto.name, dto.phone ?? null, dto.note ?? null],
    );
    return rows[0];
  }

  findById(id: number): Promise<Supplier | null> {
    return this.db.queryOne<Supplier>('SELECT * FROM suppliers WHERE id = $1', [id]);
  }

  /**
   * Scoped by shop so a supplier id from another shop reads as not-found
   * rather than leaking that it exists.
   */
  findByIdInShop(id: number, shopId: number): Promise<Supplier | null> {
    return this.db.queryOne<Supplier>(
      'SELECT * FROM suppliers WHERE id = $1 AND shop_id = $2',
      [id, shopId],
    );
  }

  /**
   * Only checks active rows: the unique index is scoped to `is_active = TRUE`,
   * so a deactivated supplier's phone is genuinely free to reuse.
   */
  findActiveByPhone(shopId: number, phone: string, excludeId?: number): Promise<Supplier | null> {
    return this.db.queryOne<Supplier>(
      `SELECT * FROM suppliers
       WHERE shop_id = $1 AND phone = $2 AND is_active = TRUE
         AND ($3::int IS NULL OR id <> $3)`,
      [shopId, phone, excludeId ?? null],
    );
  }

  async update(id: number, dto: UpdateSupplierDto): Promise<Supplier | null> {
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

    const rows = await this.db.query<Supplier>(
      `UPDATE suppliers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  /** Soft delete — the row stays so its payment history is never orphaned. */
  async deactivate(id: number): Promise<Supplier | null> {
    const rows = await this.db.query<Supplier>(
      `UPDATE suppliers SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND is_active = TRUE
       RETURNING *`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Money that stops a supplier from being deactivated: bills still owed, and
   * cancelled bills whose collected money has to come back from them. Both
   * would become invisible if the supplier disappeared from the active list.
   *
   * No explicit creditor_type filter needed: chk_debts_party_shape only ever
   * sets supplier_id on a payable row, so this can't match a receivable.
   */
  async hasBlockingDebt(supplierId: number, client?: pg.PoolClient): Promise<boolean> {
    const sql = `SELECT 1 FROM debts
                 WHERE supplier_id = $1
                   AND (status IN ('OPEN', 'PARTIAL') OR (status = 'CANCELLED' AND paid_amount > 0))
                 LIMIT 1`;

    const rows = client
      ? (await client.query(sql, [supplierId])).rows
      : await this.db.query(sql, [supplierId]);

    return rows.length > 0;
  }

  /**
   * Whether this supplier already has a live bill under this invoice number.
   * Mirrors `idx_debts_supplier_invoice_unique` — the index is the real guard
   * against a concurrent insert, this pre-check just turns the common case
   * into a clean, translatable 409 instead of a raw constraint violation.
   */
  async hasInvoice(supplierId: number, invoiceNo: string): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT 1 FROM debts
       WHERE supplier_id = $1 AND invoice_no = $2 AND status <> 'CANCELLED'
       LIMIT 1`,
      [supplierId, invoiceNo],
    );
    return rows.length > 0;
  }

  async findPaginated(
    shopId: number,
    query: SupplierQueryDto,
  ): Promise<{ data: SupplierListItem[]; total: number }> {
    const conditions = ['s.shop_id = $1'];
    const params: unknown[] = [shopId];
    let idx = 2;

    if (!query.includeInactive) {
      conditions.push('s.is_active = TRUE');
    }

    if (query.search) {
      conditions.push(`(s.name ILIKE $${idx} OR s.phone ILIKE $${idx})`);
      params.push(`%${query.search}%`);
      idx++;
    }

    // Aggregated over non-cancelled debts only, so a cancelled bill does not
    // keep showing as money owed.
    const havingClause = query.hasDebt
      ? `HAVING COALESCE(SUM(d.total_amount - d.paid_amount) FILTER (WHERE d.status IN ('OPEN', 'PARTIAL')), 0) > 0`
      : '';

    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx;

    const rows = await this.db.query<SupplierListItem & { total_count: string }>(
      `SELECT s.*,
              COUNT(d.id) FILTER (WHERE d.status IN ('OPEN', 'PARTIAL'))::int AS open_debts_count,
              COALESCE(SUM(d.total_amount - d.paid_amount)
                       FILTER (WHERE d.status IN ('OPEN', 'PARTIAL')), 0)::text AS total_remaining,
              COUNT(*) OVER() AS total_count
       FROM suppliers s
       LEFT JOIN debts d ON d.supplier_id = s.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY s.id
       ${havingClause}
       ORDER BY s.name ASC, s.id ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as SupplierListItem),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }
}
