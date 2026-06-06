import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { Order, OrderWithItems, OrderStatus } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrderQueryDto } from '../dto/order-query.dto';
import { OrderItemDto } from '../dto/create-order.dto';
import { Shop } from '../../shops/entities/shop.entity';

interface PaginatedOrders {
  data: Order[];
  total: number;
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly db: DatabaseService) {}

  findWarehouseShop(): Promise<Shop | null> {
    return this.db.queryOne<Shop>(
      `SELECT id, name, type FROM shops WHERE type = 'WAREHOUSE' LIMIT 1`,
    );
  }

  async insert(fromShopId: number, toShopId: number, totalItems: number, client: pg.PoolClient): Promise<Order> {
    const result = await client.query<Order>(
      `INSERT INTO orders (from_shop_id, to_shop_id, status, total_items)
       VALUES ($1, $2, 'PENDING', $3)
       RETURNING *`,
      [fromShopId, toShopId, totalItems],
    );
    return result.rows[0];
  }

  async insertItems(orderId: number, items: OrderItemDto[], client: pg.PoolClient): Promise<OrderItem[]> {
    const params: unknown[] = [orderId];
    const placeholders = items.map((item, i) => {
      params.push(item.productId, item.quantity);
      const base = i * 2;
      return `($1, $${base + 2}, $${base + 3}, 0)`;
    });

    const result = await client.query<OrderItem>(
      `INSERT INTO order_items (order_id, product_id, quantity, price)
       VALUES ${placeholders.join(', ')}
       RETURNING *`,
      params,
    );
    return result.rows;
  }

  async findPaginated(query: OrderQueryDto, shopId?: number): Promise<PaginatedOrders> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (shopId !== undefined) {
      conditions.push(`(o.from_shop_id = $${idx} OR o.to_shop_id = $${idx})`);
      params.push(shopId);
      idx++;
    }

    if (query.status) {
      conditions.push(`o.status = $${idx++}`);
      params.push(query.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx++;

    const rows = await this.db.query<Order & { total_count: string }>(
      `SELECT o.*, COUNT(*) OVER() AS total_count
       FROM orders o
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as Order),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  findById(id: number): Promise<OrderWithItems | null> {
    return this.db.queryOne<OrderWithItems>(
      `SELECT
         o.*,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'product_id', oi.product_id,
               'product_name', p.name,
               'quantity', oi.quantity,
               'price', oi.price
             )
           ) FILTER (WHERE oi.id IS NOT NULL),
           '[]'
         ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.id = $1
       GROUP BY o.id`,
      [id],
    );
  }

  async updateStatus(id: number, status: OrderStatus, client: pg.PoolClient): Promise<Order> {
    const result = await client.query<Order>(
      `UPDATE orders
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id],
    );
    return result.rows[0];
  }

  async findItemsByOrderId(orderId: number, client: pg.PoolClient): Promise<(OrderItem & { product_name: string })[]> {
    const result = await client.query<OrderItem & { product_name: string }>(
      `SELECT oi.*, p.name AS product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderId],
    );
    return result.rows;
  }
}
