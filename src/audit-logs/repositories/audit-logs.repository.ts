import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AuditLog, AuditLogDetail } from '../entities/audit-log.entity';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';

export interface CreateAuditLogData {
  shop_id: number | null;
  user_id: number | null;
  type: string;
  action: string;
  entity_type?: string;
  entity_id?: number;
  quantity?: number;
  amount?: number;
  notes?: string;
}

@Injectable()
export class AuditLogsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findPaginated(query: AuditLogQueryDto, scopedShopId?: number): Promise<{ data: AuditLog[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (scopedShopId !== undefined) {
      conditions.push(`al.shop_id = $${idx++}`);
      params.push(scopedShopId);
    } else if (query.shopId) {
      conditions.push(`al.shop_id = $${idx++}`);
      params.push(query.shopId);
    }

    if (query.userId) {
      conditions.push(`al.user_id = $${idx++}`);
      params.push(query.userId);
    }
    if (query.type) {
      conditions.push(`al.type = $${idx++}`);
      params.push(query.type);
    }
    if (query.action) {
      conditions.push(`al.action = $${idx++}`);
      params.push(query.action);
    }
    if (query.entityType) {
      conditions.push(`al.entity_type = $${idx++}`);
      params.push(query.entityType);
    }
    if (query.entityId) {
      conditions.push(`al.entity_id = $${idx++}`);
      params.push(query.entityId);
    }
    if (query.fromDate) {
      conditions.push(`al.created_at >= $${idx++}`);
      params.push(query.fromDate);
    }
    if (query.toDate) {
      conditions.push(`al.created_at <= $${idx++}::date + interval '1 day'`);
      params.push(query.toDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx++;

    const rows = await this.db.query<AuditLog & { total_count: string }>(
      `SELECT al.*,
              u.name AS user_name,
              s.name AS shop_name,
              COUNT(*) OVER() AS total_count
       FROM audit_logs al
       LEFT JOIN users  u ON u.id = al.user_id
       LEFT JOIN shops  s ON s.id = al.shop_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as AuditLog),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  findById(id: number): Promise<AuditLogDetail | null> {
    return this.db.queryOne<AuditLogDetail>(
      `SELECT al.*,
              u.name  AS user_name,
              s.name  AS shop_name,
              p.name  AS product_name
       FROM audit_logs al
       LEFT JOIN users     u   ON u.id   = al.user_id
       LEFT JOIN shops     s   ON s.id   = al.shop_id
       LEFT JOIN inventory inv ON inv.id = al.entity_id AND al.entity_type = 'inventory'
       LEFT JOIN products  p   ON p.id   = inv.product_id
       WHERE al.id = $1`,
      [id],
    );
  }

  async insert(data: CreateAuditLogData, client?: pg.PoolClient): Promise<AuditLog> {
    const sql = `
      INSERT INTO audit_logs (shop_id, user_id, type, action, entity_type, entity_id, quantity, amount, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const params = [
      data.shop_id ?? null,
      data.user_id ?? null,
      data.type,
      data.action,
      data.entity_type ?? null,
      data.entity_id ?? null,
      data.quantity ?? null,
      data.amount ?? null,
      data.notes ?? null,
    ];

    if (client) {
      const result = await client.query<AuditLog>(sql, params);
      return result.rows[0];
    }

    const rows = await this.db.query<AuditLog>(sql, params);
    return rows[0];
  }
}
