import { Injectable } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { Inventory, InventoryWithProduct } from '../entities/inventory.entity';
import { InventoryQueryDto } from '../dto/inventory-query.dto';

interface PaginatedInventory {
  data: InventoryWithProduct[];
  total: number;
}

@Injectable()
export class InventoryRepository {
  constructor(private readonly db: DatabaseService) {}

  async findPaginated(shopId: number, query: InventoryQueryDto): Promise<PaginatedInventory> {
    const conditions: string[] = ['i.shop_id = $1'];
    const params: unknown[] = [shopId];
    let idx = 2;

    if (query.lowStock) {
      conditions.push('i.current_quantity <= i.low_stock_threshold');
    }

    if (query.productId) {
      conditions.push(`i.product_id = $${idx++}`);
      params.push(query.productId);
    }

    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx++;

    const rows = await this.db.query<InventoryWithProduct & { total_count: string }>(
      `SELECT i.*, p.name AS product_name,
              p.category_id, c.name AS category_name, c.icon AS category_icon,
              (i.current_quantity <= i.low_stock_threshold) AS is_low_stock,
              COUNT(*) OVER() AS total_count
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY i.id ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as InventoryWithProduct),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  async findAllForAdmin(query: InventoryQueryDto): Promise<PaginatedInventory> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (query.lowStock) {
      conditions.push('i.current_quantity <= i.low_stock_threshold');
    }

    if (query.productId) {
      conditions.push(`i.product_id = $${idx++}`);
      params.push(query.productId);
    }

    if (query.shop_id) {
      conditions.push(`i.shop_id = $${idx++}`);
      params.push(query.shop_id);
    }

    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx++;

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await this.db.query<InventoryWithProduct & { total_count: string }>(
      `SELECT i.*, p.name AS product_name,
              p.category_id, c.name AS category_name, c.icon AS category_icon,
              (i.current_quantity <= i.low_stock_threshold) AS is_low_stock,
              COUNT(*) OVER() AS total_count
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       ${whereClause}
       ORDER BY i.shop_id ASC, i.id ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...row }) => row as InventoryWithProduct),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  async findById(id: number, client?: pg.PoolClient): Promise<InventoryWithProduct | null> {
    const sql = `SELECT i.*, p.name AS product_name,
              p.category_id, c.name AS category_name, c.icon AS category_icon,
              (i.current_quantity <= i.low_stock_threshold) AS is_low_stock
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE i.id = $1`;

    if (client) {
      const result = await client.query<InventoryWithProduct>(sql, [id]);
      return result.rows[0] ?? null;
    }

    return this.db.queryOne<InventoryWithProduct>(sql, [id]);
  }

  async findLowStock(shopId: number): Promise<InventoryWithProduct[]> {
    return this.db.query<InventoryWithProduct>(
      `SELECT i.*, p.name AS product_name,
              p.category_id, c.name AS category_name, c.icon AS category_icon,
              TRUE AS is_low_stock
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE i.shop_id = $1
         AND i.current_quantity <= i.low_stock_threshold
       ORDER BY i.current_quantity ASC`,
      [shopId],
    );
  }

  async findAllLowStockForAdmin(): Promise<InventoryWithProduct[]> {
    return this.db.query<InventoryWithProduct>(
      `SELECT i.*, p.name AS product_name,
              p.category_id, c.name AS category_name, c.icon AS category_icon,
              TRUE AS is_low_stock
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE i.current_quantity <= i.low_stock_threshold
       ORDER BY i.shop_id ASC, i.current_quantity ASC`,
    );
  }

  async findByShopAndProductsForUpdate(
    shopId: number,
    productIds: number[],
    client: pg.PoolClient,
  ): Promise<(Inventory & { product_name: string; is_orderable: boolean })[]> {
    const result = await client.query<Inventory & { product_name: string; is_orderable: boolean }>(
      `SELECT i.*, p.name AS product_name, p.is_orderable
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.shop_id = $1 AND i.product_id = ANY($2)
       FOR UPDATE OF i`,
      [shopId, productIds],
    );
    return result.rows;
  }

  async findByIdsForUpdate(
    ids: number[],
    client: pg.PoolClient,
  ): Promise<(Inventory & { product_name: string })[]> {
    // Both the selling price (sale_price) and the cost basis (avg_cost) come
    // from the inventory row itself via i.*, not the global product columns —
    // that's what a sale snapshots into receipt_items.price / .cost_price.
    const result = await client.query<Inventory & { product_name: string }>(
      `SELECT i.*, p.name AS product_name
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.id = ANY($1::int[])
       FOR UPDATE OF i`,
      [ids],
    );
    return result.rows;
  }

  // Product scope for a manual stock-in: a shop may stock its own product or a
  // shared warehouse product, but not another shop's private (LOCAL) product.
  // Returns null for a non-existent or inactive product.
  findProductForStockIn(
    productId: number,
  ): Promise<{ id: number; shop_id: number; source: 'WAREHOUSE' | 'LOCAL' } | null> {
    return this.db.queryOne<{ id: number; shop_id: number; source: 'WAREHOUSE' | 'LOCAL' }>(
      `SELECT id, shop_id, source FROM products WHERE id = $1 AND is_active = TRUE`,
      [productId],
    );
  }

  /**
   * Batch form of `findProductForStockIn`, for callers stocking several
   * products at once (a supplier invoice). One query instead of N, and the
   * caller compares the returned ids against what it asked for to find which
   * ones were missing — a silently short result set would otherwise read as
   * "all fine" while a line quietly went unstocked.
   */
  findProductsForStockIn(
    productIds: readonly number[],
  ): Promise<{ id: number; shop_id: number; source: 'WAREHOUSE' | 'LOCAL' }[]> {
    return this.db.query<{ id: number; shop_id: number; source: 'WAREHOUSE' | 'LOCAL' }>(
      `SELECT id, shop_id, source FROM products WHERE id = ANY($1::int[]) AND is_active = TRUE`,
      [productIds],
    );
  }

  async findByShopAndProduct(shopId: number, productId: number, client?: pg.PoolClient): Promise<Inventory | null> {
    const sql = 'SELECT * FROM inventory WHERE shop_id = $1 AND product_id = $2';
    if (client) {
      const result = await client.query<Inventory>(sql, [shopId, productId]);
      return result.rows[0] ?? null;
    }
    return this.db.queryOne<Inventory>(sql, [shopId, productId]);
  }

  /**
   * Adds `quantity` units to a (shop, product) row and folds the incoming batch
   * cost into the moving-average `avg_cost`, atomically.
   *
   * `addCost` is tri-state:
   *   - a number (incl. 0) → the unit cost of this batch; blended in.
   *   - null               → cost unknown: seed a brand-new row from the
   *                          product's cost_price, or leave an existing row's
   *                          avg_cost untouched (quantity still increases).
   *
   * The blend runs inside the ON CONFLICT so two concurrent stock-ins (or the
   * first-ever stock-in racing itself) can't corrupt the average.
   *
   * sale_price is seeded from products.price only when the row is first created
   * (it's in the INSERT but not the DO UPDATE) — seed-once, so a price the shop
   * owner later sets via PATCH /inventory/:id/price is never overwritten by a
   * subsequent stock-in or order receipt.
   */
  async upsertStockIn(
    shopId: number,
    productId: number,
    quantity: number,
    addCost: number | null,
    client: pg.PoolClient,
  ): Promise<Inventory> {
    const result = await client.query<Inventory>(
      `INSERT INTO inventory (shop_id, product_id, current_quantity, avg_cost, sale_price)
       VALUES ($1, $2, $3,
               COALESCE($4::numeric, (SELECT cost_price FROM products WHERE id = $2), 0),
               COALESCE((SELECT price FROM products WHERE id = $2), 0))
       ON CONFLICT (shop_id, product_id)
       DO UPDATE SET
         avg_cost = CASE
           WHEN $4::numeric IS NULL THEN inventory.avg_cost
           ELSE ROUND(
             (inventory.current_quantity * inventory.avg_cost + EXCLUDED.current_quantity * $4::numeric)
             / NULLIF(inventory.current_quantity + EXCLUDED.current_quantity, 0),
             4
           )
         END,
         current_quantity = inventory.current_quantity + EXCLUDED.current_quantity,
         updated_at = NOW()
       RETURNING *`,
      [shopId, productId, quantity, addCost],
    );
    return result.rows[0];
  }

  /**
   * Registers a catalog product onto a shop's inventory without a cost-bearing
   * stock-in — the "add from catalog" onboarding action. Seeds a new row at
   * `quantity` (default 0), inheriting avg_cost/sale_price from the product just
   * like the INSERT half of upsertStockIn. Restocking is left to the orders flow.
   *
   * ON CONFLICT DO NOTHING makes it idempotent: if the (shop, product) row
   * already exists it is left untouched and this returns `null`, so the caller
   * can treat a re-add as a no-op rather than double-counting stock.
   */
  async registerProduct(
    shopId: number,
    productId: number,
    quantity: number,
    client: pg.PoolClient,
  ): Promise<Inventory | null> {
    const result = await client.query<Inventory>(
      `INSERT INTO inventory (shop_id, product_id, current_quantity, avg_cost, sale_price)
       VALUES ($1, $2, $3,
               COALESCE((SELECT cost_price FROM products WHERE id = $2), 0),
               COALESCE((SELECT price FROM products WHERE id = $2), 0))
       ON CONFLICT (shop_id, product_id) DO NOTHING
       RETURNING *`,
      [shopId, productId, quantity],
    );
    return result.rows[0] ?? null;
  }

  async updateSalePrice(id: number, salePrice: number, client: pg.PoolClient): Promise<Inventory | null> {
    const result = await client.query<Inventory>(
      `UPDATE inventory
       SET sale_price = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [salePrice, id],
    );
    return result.rows[0] ?? null;
  }

  async updateLowStockThreshold(id: number, threshold: number, client: pg.PoolClient): Promise<Inventory | null> {
    const result = await client.query<Inventory>(
      `UPDATE inventory
       SET low_stock_threshold = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [threshold, id],
    );
    return result.rows[0] ?? null;
  }

  async adjust(id: number, delta: number, client: pg.PoolClient): Promise<Inventory | null> {
    const result = await client.query<Inventory>(
      `UPDATE inventory
       SET current_quantity = current_quantity + $1,
           updated_at = NOW()
       WHERE id = $2
         AND current_quantity + $1 >= 0
       RETURNING *`,
      [delta, id],
    );
    return result.rows[0] ?? null;
  }
}
