import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Notification } from '../entities/notification.entity';
import { NotificationQueryDto } from '../dto/notification-query.dto';

export interface CreateNotificationData {
  shop_id: number;
  user_id?: number | null;
  title: string;
  message?: string;
  type?: string;
  args?: Record<string, unknown> | null;
}

interface PaginatedNotifications {
  data: Notification[];
  total: number;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(data: CreateNotificationData): Promise<Notification> {
    const rows = await this.db.query<Notification>(
      `INSERT INTO notifications (shop_id, user_id, title, message, type, args)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.shop_id,
        data.user_id ?? null,
        data.title,
        data.message ?? null,
        data.type ?? null,
        data.args ? JSON.stringify(data.args) : null,
      ],
    );
    return rows[0];
  }

  async findPaginatedForShop(shopId: number, query: NotificationQueryDto): Promise<PaginatedNotifications> {
    const conditions: string[] = ['n.shop_id = $1'];
    const params: unknown[] = [shopId];
    let idx = 2;

    if (query.isRead !== undefined) {
      conditions.push(`n.is_read = $${idx++}`);
      params.push(query.isRead);
    }

    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx++;

    const rows = await this.db.query<Notification & { total_count: string }>(
      `SELECT n.*, COUNT(*) OVER() AS total_count
       FROM notifications n
       WHERE ${conditions.join(' AND ')}
       ORDER BY n.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as Notification),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  async markRead(id: number, shopId: number): Promise<Notification | null> {
    const rows = await this.db.query<Notification>(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND shop_id = $2
       RETURNING *`,
      [id, shopId],
    );
    return rows[0] ?? null;
  }

  async markAllRead(shopId: number): Promise<void> {
    await this.db.query(
      `UPDATE notifications SET is_read = TRUE WHERE shop_id = $1 AND is_read = FALSE`,
      [shopId],
    );
  }

  async hasUnreadLowStock(shopId: number, productName: string): Promise<boolean> {
    const row = await this.db.queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM notifications
         WHERE shop_id = $1
           AND type = 'LOW_STOCK'
           AND args->>'productName' = $2
           AND is_read = FALSE
       ) AS exists`,
      [shopId, productName],
    );
    return row?.exists ?? false;
  }
}
