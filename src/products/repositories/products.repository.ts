import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Product } from '../entities/product.entity';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductQueryDto } from '../dto/product-query.dto';

interface PaginatedProducts {
  data: Product[];
  total: number;
}

@Injectable()
export class ProductsRepository {
  constructor(private readonly db: DatabaseService) {}

  // Admin: all active products (optional shop/source/category filters)
  async findPaginatedAdmin(query: ProductQueryDto): Promise<PaginatedProducts> {
    const conditions: string[] = ['p.is_active = TRUE'];
    const params: unknown[] = [];
    let idx = 1;

    if (query.shop_id)    { conditions.push(`p.shop_id = $${idx++}`);      params.push(query.shop_id); }
    if (query.source)     { conditions.push(`p.source = $${idx++}`);       params.push(query.source); }
    if (query.category_id){ conditions.push(`p.category_id = $${idx++}`);  params.push(query.category_id); }

    params.push(query.limit, query.offset);
    const limitIdx = idx++; const offsetIdx = idx++;

    const rows = await this.db.query<Product & { total_count: string }>(
      `SELECT p.*, COUNT(*) OVER() AS total_count
       FROM products p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...p }) => p as Product),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  // SHOP_OWNER / EMPLOYEE: own shop + warehouse products
  async findPaginatedForShop(shopId: number, query: ProductQueryDto): Promise<PaginatedProducts> {
    const conditions: string[] = [
      'p.is_active = TRUE',
      `(p.shop_id = $1 OR p.source = 'WAREHOUSE')`,
    ];
    const params: unknown[] = [shopId];
    let idx = 2;

    if (query.source)     { conditions.push(`p.source = $${idx++}`);      params.push(query.source); }
    if (query.category_id){ conditions.push(`p.category_id = $${idx++}`); params.push(query.category_id); }

    params.push(query.limit, query.offset);
    const limitIdx = idx++; const offsetIdx = idx++;

    const rows = await this.db.query<Product & { total_count: string }>(
      `SELECT p.*, COUNT(*) OVER() AS total_count
       FROM products p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.source DESC, p.created_at DESC
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
      'SELECT * FROM products WHERE id = $1 AND is_active = TRUE',
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
    categoryId: number,
    shopId: number,
  ): Promise<Product> {
    const rows = await this.db.query<Product>(
      `INSERT INTO products (name, description, barcode, price, category_id, shop_id, source, is_global)
       SELECT $1, $2, $3, $4, $5, s.id,
         CASE WHEN s.type = 'WAREHOUSE' THEN 'WAREHOUSE' ELSE 'LOCAL' END,
         CASE WHEN s.type = 'WAREHOUSE' THEN TRUE ELSE FALSE END
       FROM shops s WHERE s.id = $6
       RETURNING *`,
      [name, description ?? null, barcode ?? null, price, categoryId, shopId],
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
    if (dto.category_id !== undefined) { fields.push(`category_id = $${idx++}`); values.push(dto.category_id); }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const rows = await this.db.query<Product>(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0];
  }

  async softDelete(id: number): Promise<void> {
    await this.db.execute(
      'UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [id],
    );
  }
}
