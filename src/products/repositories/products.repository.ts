import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Product } from '../entities/product.entity';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductQueryDto, StockStatus } from '../dto/product-query.dto';

interface PaginatedProducts {
  data: Product[];
  total: number;
}

@Injectable()
export class ProductsRepository {
  constructor(private readonly db: DatabaseService) {}

  // Admin: products with optional is_active, source, category, shop, and stock-level filters
  async findPaginatedAdmin(query: ProductQueryDto): Promise<PaginatedProducts> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    // Default to active-only; pass is_active=false to see inactive products
    conditions.push(query.is_active === false ? 'p.is_active = FALSE' : 'p.is_active = TRUE');

    if (query.search)        { conditions.push(`(p.name ILIKE $${idx} OR p.barcode ILIKE $${idx})`); params.push(`%${query.search}%`); idx++; }
    if (query.shop_id)      { conditions.push(`p.shop_id = $${idx++}`);                params.push(query.shop_id); }
    if (query.shop_name)    { conditions.push(`s.name ILIKE $${idx++}`);               params.push(`%${query.shop_name}%`); }
    if (query.source)       { conditions.push(`p.source = $${idx++}`);                 params.push(query.source); }
    if (query.category_name){ conditions.push(`c.name ILIKE $${idx++}`);               params.push(query.category_name); }
    if (query.is_orderable !== undefined) { conditions.push(`p.is_orderable = $${idx++}`); params.push(query.is_orderable); }

    if (query.stock_status === StockStatus.OUT_OF_STOCK) {
      conditions.push('COALESCE(i.current_quantity, 0) = 0');
    } else if (query.stock_status === StockStatus.LOW_STOCK) {
      conditions.push('COALESCE(i.current_quantity, 0) > 0 AND i.current_quantity <= i.low_stock_threshold');
    } else if (query.stock_status === StockStatus.HIGH_STOCK) {
      conditions.push('COALESCE(i.current_quantity, 0) > COALESCE(i.low_stock_threshold, 10)');
    } else if (query.stock_status === StockStatus.IN_STOCK) {
      conditions.push('COALESCE(i.current_quantity, 0) > 0');
    }

    params.push(query.limit, query.offset);
    const limitIdx = idx++; const offsetIdx = idx++;

    const rows = await this.db.query<Product & { total_count: string }>(
      `SELECT p.*, c.name AS category_name, c.icon AS category_icon, COUNT(*) OVER() AS total_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN inventory i ON i.product_id = p.id AND i.shop_id = p.shop_id
       LEFT JOIN shops s ON s.id = p.shop_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...p }) => p as Product),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  // SHOP_OWNER / EMPLOYEE: own shop + warehouse products
  //
  // Both list queries order by created_at with `p.id` as a tiebreaker. The
  // seeded warehouse catalog is inserted in one transaction, so all 140 rows
  // share the same created_at; without the tiebreaker Postgres returns those
  // ties in arbitrary order, and LIMIT/OFFSET pages can overlap or skip rows
  // from one request to the next.
  async findPaginatedForShop(shopId: number, query: ProductQueryDto): Promise<PaginatedProducts> {
    const conditions: string[] = [
      'p.is_active = TRUE',
      `(p.shop_id = $1 OR p.source = 'WAREHOUSE')`,
    ];
    const params: unknown[] = [shopId];
    let idx = 2;

    if (query.search)        { conditions.push(`(p.name ILIKE $${idx} OR p.barcode ILIKE $${idx})`); params.push(`%${query.search}%`); idx++; }
    if (query.source)        { conditions.push(`p.source = $${idx++}`);   params.push(query.source); }
    if (query.category_name) { conditions.push(`c.name ILIKE $${idx++}`); params.push(query.category_name); }
    if (query.is_orderable !== undefined) { conditions.push(`p.is_orderable = $${idx++}`); params.push(query.is_orderable); }

    if (query.stock_status === StockStatus.OUT_OF_STOCK) {
      conditions.push('COALESCE(wi.current_quantity, 0) = 0');
    } else if (query.stock_status === StockStatus.LOW_STOCK) {
      conditions.push('COALESCE(wi.current_quantity, 0) > 0 AND wi.current_quantity <= wi.low_stock_threshold');
    } else if (query.stock_status === StockStatus.HIGH_STOCK) {
      conditions.push('COALESCE(wi.current_quantity, 0) > COALESCE(wi.low_stock_threshold, 10)');
    } else if (query.stock_status === StockStatus.IN_STOCK) {
      conditions.push('COALESCE(wi.current_quantity, 0) > 0');
    }

    params.push(query.limit, query.offset);
    const limitIdx = idx++; const offsetIdx = idx++;

    const rows = await this.db.query<Product & { total_count: string }>(
      `SELECT p.*, c.name AS category_name, c.icon AS category_icon,
              (i.id IS NOT NULL) AS in_inventory,
              COALESCE(i.current_quantity, 0) AS current_quantity,
              COUNT(*) OVER() AS total_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN inventory i ON i.product_id = p.id AND i.shop_id = $1
       LEFT JOIN inventory wi ON wi.product_id = p.id AND wi.shop_id = p.shop_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.source DESC, p.created_at DESC, p.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...p }) => p as Product),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  findById(id: number): Promise<Product | null> {
    return this.db.queryOne<Product>(
      `SELECT p.*, c.name AS category_name, c.icon AS category_icon, COALESCE(i.current_quantity, 0) AS current_quantity
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN inventory i ON i.product_id = p.id AND i.shop_id = p.shop_id
       WHERE p.id = $1 AND p.is_active = TRUE`,
      [id],
    );
  }

  findByBarcodeAndShop(barcode: string, shopId: number, excludeId?: number): Promise<Product | null> {
    if (excludeId !== undefined) {
      return this.db.queryOne<Product>(
        'SELECT * FROM products WHERE barcode = $1 AND shop_id = $2 AND id != $3 AND is_active = TRUE',
        [barcode, shopId, excludeId],
      );
    }
    return this.db.queryOne<Product>(
      'SELECT * FROM products WHERE barcode = $1 AND shop_id = $2 AND is_active = TRUE',
      [barcode, shopId],
    );
  }

  // Case-insensitive, matching the ILIKE search convention used elsewhere in this repo.
  findByNameAndShop(name: string, shopId: number, excludeId?: number): Promise<Product | null> {
    if (excludeId !== undefined) {
      return this.db.queryOne<Product>(
        'SELECT * FROM products WHERE LOWER(name) = LOWER($1) AND shop_id = $2 AND id != $3 AND is_active = TRUE',
        [name, shopId, excludeId],
      );
    }
    return this.db.queryOne<Product>(
      'SELECT * FROM products WHERE LOWER(name) = LOWER($1) AND shop_id = $2 AND is_active = TRUE',
      [name, shopId],
    );
  }

  async shopExists(shopId: number): Promise<boolean> {
    const row = await this.db.queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM shops WHERE id = $1) AS exists`,
      [shopId],
    );
    return row!.exists;
  }

  // Checks the category is accessible to the target shop (own or warehouse)
  async categoryAccessible(categoryId: number, shopId: number): Promise<boolean> {
    const row = await this.db.queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM categories c
         JOIN shops s ON c.shop_id = s.id
         WHERE c.id = $1
           AND (c.shop_id = $2 OR s.type = 'WAREHOUSE')
       ) AS exists`,
      [categoryId, shopId],
    );
    return row!.exists;
  }

  // source and is_global are auto-set from the shop's type — user cannot spoof them
  async insert(
    name: string,
    description: string | undefined,
    barcode: string | undefined,
    price: number,
    costPrice: number,
    categoryId: number,
    shopId: number,
    isOrderable = true,
  ): Promise<Product> {
    const rows = await this.db.query<Product>(
      `INSERT INTO products (name, description, barcode, price, cost_price, category_id, shop_id, source, is_global, is_orderable)
       SELECT $1, $2, $3, $4, $5, $6, s.id,
         CASE WHEN s.type = 'WAREHOUSE' THEN 'WAREHOUSE' ELSE 'LOCAL' END,
         CASE WHEN s.type = 'WAREHOUSE' THEN TRUE ELSE FALSE END,
         $8
       FROM shops s WHERE s.id = $7
       RETURNING *`,
      [name, description ?? null, barcode ?? null, price, costPrice, categoryId, shopId, isOrderable],
    );
    return rows[0];
  }

  async update(id: number, dto: UpdateProductDto): Promise<Product> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined)        { fields.push(`name = $${idx++}`);        values.push(dto.name); }
    if (dto.description !== undefined) { fields.push(`description = $${idx++}`); values.push(dto.description); }
    if (dto.barcode !== undefined)     { fields.push(`barcode = $${idx++}`);     values.push(dto.barcode); }
    if (dto.price !== undefined)       { fields.push(`price = $${idx++}`);       values.push(dto.price); }
    if (dto.cost_price !== undefined)  { fields.push(`cost_price = $${idx++}`);  values.push(dto.cost_price); }
    if (dto.category_id !== undefined) { fields.push(`category_id = $${idx++}`); values.push(dto.category_id); }
    if (dto.is_orderable !== undefined){ fields.push(`is_orderable = $${idx++}`);values.push(dto.is_orderable); }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const rows = await this.db.query<Product>(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0];
  }

  async updateImage(id: number, imageUrl: string): Promise<void> {
    await this.db.execute(
      'UPDATE products SET image_url = $1, updated_at = NOW() WHERE id = $2',
      [imageUrl, id],
    );
  }

  async deleteImage(id: number): Promise<void> {
    await this.db.execute(
      'UPDATE products SET image_url = NULL, updated_at = NOW() WHERE id = $1',
      [id],
    );
  }

  async softDelete(id: number): Promise<void> {
    await this.db.execute(
      'UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [id],
    );
  }
}
