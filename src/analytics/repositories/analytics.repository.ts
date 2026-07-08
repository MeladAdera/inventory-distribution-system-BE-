import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { TrendPeriod } from '../dto/analytics-query.dto';

export interface TopProductRow {
  product_id: number;
  product_name: string;
  total_quantity: number;
}

export interface TrendRow {
  label: string;
  value: number;
}

export interface ShopConsumptionRow {
  product_id: number;
  product_name: string;
  quantity: number;
}

export interface PaginatedShopConsumption {
  data: ShopConsumptionRow[];
  total: number;
}

export interface ProductByShopRawRow {
  product_id: number;
  product_name: string;
  total_quantity: number;
  shop_id: number;
  shop_name: string;
  shop_quantity: number;
}

export interface ProductByShopRow {
  product_id: number;
  product_name: string;
  total_quantity: number;
  shops: { shop_id: number; shop_name: string; quantity: number }[];
}

export interface ProfitSummaryRow {
  revenue: number;
  cost: number;
  profit: number;
}

export interface ProfitTrendRow extends ProfitSummaryRow {
  label: string;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly db: DatabaseService) {}

  // labelExpr and intervalExpr are hardcoded per case, dateColumn is internal —
  // nothing here derives from user input
  private periodExprs(period: TrendPeriod, dateColumn: string): { labelExpr: string; intervalExpr: string } {
    switch (period) {
      case TrendPeriod.WEEKLY:
        return {
          labelExpr: `TO_CHAR(DATE_TRUNC('week', ${dateColumn}), 'IYYY-"W"IW')`,
          intervalExpr: `NOW() - INTERVAL '1 week'`,
        };
      case TrendPeriod.MONTHLY:
        return {
          labelExpr: `TO_CHAR(DATE_TRUNC('month', ${dateColumn}), 'YYYY-MM')`,
          intervalExpr: `NOW() - INTERVAL '1 month'`,
        };
      default: // daily
        return {
          labelExpr: `TO_CHAR(DATE(${dateColumn}), 'YYYY-MM-DD')`,
          intervalExpr: `NOW() - INTERVAL '1 day'`,
        };
    }
  }

  // Warehouse profit: what shops paid (price) minus warehouse cost, from COMPLETED orders
  async getWarehouseProfitSummary(period: TrendPeriod): Promise<ProfitSummaryRow> {
    const { intervalExpr } = this.periodExprs(period, 'o.updated_at');
    const row = await this.db.queryOne<ProfitSummaryRow>(
      `SELECT COALESCE(SUM(oi.quantity * oi.price), 0)::float8                     AS revenue,
              COALESCE(SUM(oi.quantity * oi.cost_price), 0)::float8                AS cost,
              COALESCE(SUM(oi.quantity * (oi.price - oi.cost_price)), 0)::float8   AS profit
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'COMPLETED'
         AND o.updated_at >= ${intervalExpr}`,
    );
    return row!;
  }

  // Shop profit: customer sales (receipts) minus cost snapshots.
  // Free receipts contribute no revenue but still incur cost, so they show up
  // as a straight loss rather than being dropped from the totals entirely.
  async getShopProfitSummary(period: TrendPeriod, shopId: number): Promise<ProfitSummaryRow> {
    const { intervalExpr } = this.periodExprs(period, 'r.created_at');
    const row = await this.db.queryOne<ProfitSummaryRow>(
      `SELECT COALESCE(SUM(CASE WHEN r.is_free THEN 0 ELSE ri.quantity * ri.price END), 0)::float8 AS revenue,
              COALESCE(SUM(ri.quantity * ri.cost_price), 0)::float8                                AS cost,
              COALESCE(SUM(CASE WHEN r.is_free THEN -(ri.quantity * ri.cost_price)
                                 ELSE ri.quantity * (ri.price - ri.cost_price) END), 0)::float8     AS profit
       FROM receipt_items ri
       JOIN receipts r ON r.id = ri.receipt_id
       WHERE r.shop_id = $1
         AND r.created_at >= ${intervalExpr}`,
      [shopId],
    );
    return row!;
  }

  getWarehouseProfitTrend(period: TrendPeriod): Promise<ProfitTrendRow[]> {
    const { labelExpr, intervalExpr } = this.periodExprs(period, 'o.updated_at');
    return this.db.query<ProfitTrendRow>(
      `SELECT ${labelExpr}                                                         AS label,
              COALESCE(SUM(oi.quantity * oi.price), 0)::float8                     AS revenue,
              COALESCE(SUM(oi.quantity * oi.cost_price), 0)::float8                AS cost,
              COALESCE(SUM(oi.quantity * (oi.price - oi.cost_price)), 0)::float8   AS profit
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'COMPLETED'
         AND o.updated_at >= ${intervalExpr}
       GROUP BY label
       ORDER BY label ASC`,
    );
  }

  getShopProfitTrend(period: TrendPeriod, shopId: number): Promise<ProfitTrendRow[]> {
    const { labelExpr, intervalExpr } = this.periodExprs(period, 'r.created_at');
    return this.db.query<ProfitTrendRow>(
      `SELECT ${labelExpr}                                                                         AS label,
              COALESCE(SUM(CASE WHEN r.is_free THEN 0 ELSE ri.quantity * ri.price END), 0)::float8 AS revenue,
              COALESCE(SUM(ri.quantity * ri.cost_price), 0)::float8                                AS cost,
              COALESCE(SUM(CASE WHEN r.is_free THEN -(ri.quantity * ri.cost_price)
                                 ELSE ri.quantity * (ri.price - ri.cost_price) END), 0)::float8     AS profit
       FROM receipt_items ri
       JOIN receipts r ON r.id = ri.receipt_id
       WHERE r.shop_id = $1
         AND r.created_at >= ${intervalExpr}
       GROUP BY label
       ORDER BY label ASC`,
      [shopId],
    );
  }

  getTopProducts(limit: number, shopId?: number): Promise<TopProductRow[]> {
    const params: unknown[] = [limit];
    let shopFilter = '';

    if (shopId !== undefined) {
      params.push(shopId);
      shopFilter = `AND o.to_shop_id = $2`;
    }

    return this.db.query<TopProductRow>(
      `SELECT oi.product_id,
              p.name  AS product_name,
              SUM(oi.quantity)::int AS total_quantity
       FROM order_items oi
       JOIN orders   o ON o.id  = oi.order_id
       JOIN products p ON p.id  = oi.product_id
       WHERE o.status = 'COMPLETED'
         ${shopFilter}
       GROUP BY oi.product_id, p.name
       ORDER BY total_quantity DESC
       LIMIT $1`,
      params,
    );
  }

  getConsumptionTrend(period: TrendPeriod, shopId?: number): Promise<TrendRow[]> {
    const params: unknown[] = [];
    let shopFilter = '';

    if (shopId !== undefined) {
      params.push(shopId);
      shopFilter = `AND o.to_shop_id = $1`;
    }

    // labelExpr and intervalExpr are hardcoded per case — not derived from user input
    let labelExpr: string;
    let intervalExpr: string;

    switch (period) {
      case TrendPeriod.WEEKLY:
        labelExpr = `TO_CHAR(DATE_TRUNC('week', o.updated_at), 'IYYY-"W"IW')`;
        intervalExpr = `NOW() - INTERVAL '1 week'`;
        break;
      case TrendPeriod.MONTHLY:
        labelExpr = `TO_CHAR(DATE_TRUNC('month', o.updated_at), 'YYYY-MM')`;
        intervalExpr = `NOW() - INTERVAL '1 month'`;
        break;
      default: // daily
        labelExpr = `TO_CHAR(DATE(o.updated_at), 'YYYY-MM-DD')`;
        intervalExpr = `NOW() - INTERVAL '1 day'`;
    }

    return this.db.query<TrendRow>(
      `SELECT ${labelExpr} AS label,
              SUM(oi.quantity)::int AS value
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status = 'COMPLETED'
         AND o.updated_at >= ${intervalExpr}
         ${shopFilter}
       GROUP BY label
       ORDER BY label ASC`,
      params.length > 0 ? params : undefined,
    );
  }

  async getShopConsumption(
    period: TrendPeriod,
    shopId: number,
    limit: number,
    offset: number,
  ): Promise<PaginatedShopConsumption> {
    // intervalExpr is hardcoded per case — not derived from user input
    let intervalExpr: string;
    switch (period) {
      case TrendPeriod.WEEKLY:
        intervalExpr = `NOW() - INTERVAL '1 week'`;
        break;
      case TrendPeriod.MONTHLY:
        intervalExpr = `NOW() - INTERVAL '1 month'`;
        break;
      default:
        intervalExpr = `NOW() - INTERVAL '1 day'`;
    }

    const rows = await this.db.query<ShopConsumptionRow & { total_count: string }>(
      `SELECT ri.product_id,
              p.name               AS product_name,
              SUM(ri.quantity)::int AS quantity,
              COUNT(*) OVER()       AS total_count
       FROM receipt_items ri
       JOIN receipts r ON r.id = ri.receipt_id
       JOIN products p ON p.id = ri.product_id
       WHERE r.shop_id    = $1
         AND r.created_at >= ${intervalExpr}
       GROUP BY ri.product_id, p.name
       ORDER BY quantity DESC
       LIMIT $2 OFFSET $3`,
      [shopId, limit, offset],
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as ShopConsumptionRow),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  getProductsByShop(
    period: TrendPeriod,
    limit: number,
    shopId?: number,
  ): Promise<ProductByShopRawRow[]> {
    const params: unknown[] = [limit];
    let shopFilter = '';

    if (shopId !== undefined) {
      params.push(shopId);
      shopFilter = `AND o.to_shop_id = $2`;
    }

    // intervalExpr is hardcoded per case — not derived from user input
    let intervalExpr: string;
    switch (period) {
      case TrendPeriod.WEEKLY:
        intervalExpr = `NOW() - INTERVAL '1 week'`;
        break;
      case TrendPeriod.MONTHLY:
        intervalExpr = `NOW() - INTERVAL '1 month'`;
        break;
      default:
        intervalExpr = `NOW() - INTERVAL '1 day'`;
    }

    return this.db.query<ProductByShopRawRow>(
      `WITH product_shop AS (
         SELECT oi.product_id,
                p.name               AS product_name,
                o.to_shop_id         AS shop_id,
                s.name               AS shop_name,
                SUM(oi.quantity)::int AS shop_quantity
         FROM order_items oi
         JOIN orders   o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         JOIN shops    s ON s.id = o.to_shop_id
         WHERE o.status = 'COMPLETED'
           AND o.updated_at >= ${intervalExpr}
           ${shopFilter}
         GROUP BY oi.product_id, p.name, o.to_shop_id, s.name
       ),
       product_totals AS (
         SELECT product_id,
                product_name,
                SUM(shop_quantity)::int AS total_quantity
         FROM product_shop
         GROUP BY product_id, product_name
         ORDER BY total_quantity DESC
         LIMIT $1
       )
       SELECT pt.product_id,
              pt.product_name,
              pt.total_quantity,
              ps.shop_id,
              ps.shop_name,
              ps.shop_quantity
       FROM product_totals pt
       JOIN product_shop ps ON ps.product_id = pt.product_id
       ORDER BY pt.total_quantity DESC, ps.shop_quantity DESC`,
      params,
    );
  }
}
