import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Category } from '../entities/category.entity';
import { UpdateCategoryDto } from '../dto/update-category.dto';

@Injectable()
export class CategoriesRepository {
  constructor(private readonly db: DatabaseService) {}

  // Admin with no filter — every category across all shops
  findAll(): Promise<Category[]> {
    return this.db.query<Category>(
      'SELECT * FROM categories ORDER BY shop_id, name',
    );
  }

  // Admin filtering by one specific shop
  findAllByShop(shopId: number): Promise<Category[]> {
    return this.db.query<Category>(
      'SELECT * FROM categories WHERE shop_id = $1 ORDER BY name',
      [shopId],
    );
  }

  // SHOP_OWNER / EMPLOYEE — own categories + warehouse categories (global)
  findAllForShop(shopId: number): Promise<Category[]> {
    return this.db.query<Category>(
      `SELECT c.* FROM categories c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.shop_id = $1 OR s.type = 'WAREHOUSE'
       ORDER BY s.type DESC, c.name`,
      [shopId],
    );
  }

  findById(id: number): Promise<Category | null> {
    return this.db.queryOne<Category>(
      'SELECT * FROM categories WHERE id = $1',
      [id],
    );
  }

  // Used to enforce name uniqueness within a shop (excludes the current row on updates)
  findByNameAndShop(name: string, shopId: number, excludeId?: number): Promise<Category | null> {
    if (excludeId !== undefined) {
      return this.db.queryOne<Category>(
        'SELECT * FROM categories WHERE LOWER(name) = LOWER($1) AND shop_id = $2 AND id != $3',
        [name, shopId, excludeId],
      );
    }
    return this.db.queryOne<Category>(
      'SELECT * FROM categories WHERE LOWER(name) = LOWER($1) AND shop_id = $2',
      [name, shopId],
    );
  }

  async insert(name: string, shopId: number): Promise<Category> {
    const rows = await this.db.query<Category>(
      'INSERT INTO categories (name, shop_id) VALUES ($1, $2) RETURNING *',
      [name, shopId],
    );
    return rows[0];
  }

  async update(id: number, dto: UpdateCategoryDto): Promise<Category> {
    const rows = await this.db.query<Category>(
      'UPDATE categories SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [dto.name, id],
    );
    return rows[0];
  }

  async updateImage(id: number, imageUrl: string): Promise<void> {
    await this.db.execute(
      'UPDATE categories SET image_url = $1, updated_at = NOW() WHERE id = $2',
      [imageUrl, id],
    );
  }

  async deleteImage(id: number): Promise<void> {
    await this.db.execute(
      'UPDATE categories SET image_url = NULL, updated_at = NOW() WHERE id = $1',
      [id],
    );
  }

  async deleteById(id: number): Promise<void> {
    await this.db.execute('DELETE FROM categories WHERE id = $1', [id]);
  }

  // Returns true if any product is assigned to this category
  async hasProducts(categoryId: number): Promise<boolean> {
    const row = await this.db.queryOne<{ count: string }>(
      'SELECT COUNT(*) AS count FROM products WHERE category_id = $1',
      [categoryId],
    );
    return parseInt(row!.count, 10) > 0;
  }
}
