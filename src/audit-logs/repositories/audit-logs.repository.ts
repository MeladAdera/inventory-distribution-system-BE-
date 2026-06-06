import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AuditLog } from '../entities/audit-log.entity';

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
