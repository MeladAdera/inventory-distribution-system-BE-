import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { Receipt, ReceiptWithItems, ReceiptListItem } from '../entities/receipt.entity';
import { ReceiptQueryDto } from '../dto/receipt-query.dto';

interface PaginatedReceipts {
  data: ReceiptListItem[];
  total: number;
}

export interface ReceiptItemInsert {
  inventoryId: number;
  productId: number;
  quantity: number;
  price: string;
  costPrice: string;
  quantityBefore: number;
  quantityAfter: number;
}

@Injectable()
export class ReceiptsRepository {
  constructor(private readonly db: DatabaseService) {}

  async insertReceipt(
    shopId: number,
    createdBy: number,
    notes: string | undefined,
    client: pg.PoolClient,
  ): Promise<Receipt> {
    const result = await client.query<Receipt>(
      `INSERT INTO receipts (shop_id, created_by, notes)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [shopId, createdBy, notes ?? null],
    );
    return result.rows[0];
  }

  async insertItems(
    receiptId: number,
    items: ReceiptItemInsert[],
    client: pg.PoolClient,
  ): Promise<void> {
    const params: unknown[] = [receiptId];
    const placeholders = items.map((item, i) => {
      params.push(item.inventoryId, item.productId, item.quantity, item.price, item.costPrice, item.quantityBefore, item.quantityAfter);
      const base = i * 7;
      return `($1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    });

    await client.query(
      `INSERT INTO receipt_items (receipt_id, inventory_id, product_id, quantity, price, cost_price, quantity_before, quantity_after)
       VALUES ${placeholders.join(', ')}`,
      params,
    );
  }

  setIsFree(id: number, isFree: boolean): Promise<Receipt | null> {
    return this.db.queryOne<Receipt>(
      `UPDATE receipts SET is_free = $2 WHERE id = $1 RETURNING *`,
      [id, isFree],
    );
  }

  findById(id: number): Promise<ReceiptWithItems | null> {
    return this.db.queryOne<ReceiptWithItems>(
      `SELECT
         r.id, r.shop_id, r.created_by, r.notes, r.is_free, r.created_at,
         COALESCE(SUM(ri.quantity * ri.price), 0)::float8 AS total_price,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'id',              ri.id,
               'inventory_id',    ri.inventory_id,
               'product_id',      ri.product_id,
               'product_name',    p.name,
               'quantity',        ri.quantity,
               'price',           ri.price,
               'quantity_before', ri.quantity_before,
               'quantity_after',  ri.quantity_after
             )
             ORDER BY ri.id ASC
           ) FILTER (WHERE ri.id IS NOT NULL),
           '[]'
         ) AS items
       FROM receipts r
       LEFT JOIN receipt_items ri ON ri.receipt_id = r.id
       LEFT JOIN products      p  ON p.id = ri.product_id
       WHERE r.id = $1
       GROUP BY r.id`,
      [id],
    );
  }

  async findPaginated(query: ReceiptQueryDto, scopedShopId?: number): Promise<PaginatedReceipts> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (scopedShopId !== undefined) {
      conditions.push(`r.shop_id = $${idx++}`);
      params.push(scopedShopId);
    } else if (query.shopId !== undefined) {
      conditions.push(`r.shop_id = $${idx++}`);
      params.push(query.shopId);
    }

    if (query.createdBy !== undefined) {
      conditions.push(`r.created_by = $${idx++}`);
      params.push(query.createdBy);
    }

    if (query.fromDate) {
      conditions.push(`r.created_at >= $${idx++}`);
      params.push(query.fromDate);
    }

    if (query.toDate) {
      conditions.push(`r.created_at < ($${idx++}::date + interval '1 day')`);
      params.push(query.toDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx;

    const rows = await this.db.query<ReceiptListItem & { total_count: string }>(
      `SELECT
         r.id, r.shop_id, r.created_by, r.notes, r.is_free, r.created_at,
         s.name           AS shop_name,
         u.name           AS created_by_name,
         COUNT(ri.id)::int AS total_items,
         COUNT(*) OVER()  AS total_count
       FROM receipts r
       JOIN shops         s  ON s.id = r.shop_id
       JOIN users         u  ON u.id = r.created_by
       LEFT JOIN receipt_items ri ON ri.receipt_id = r.id
       ${whereClause}
       GROUP BY r.id, s.name, u.name
       ORDER BY r.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as ReceiptListItem),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }
}
