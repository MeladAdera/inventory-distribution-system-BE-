import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { User, SafeUser } from '../entities/user.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserQueryDto } from '../dto/user-query.dto';

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.db.queryOne<User>(
      `SELECT u.*, s.is_active AS shop_is_active
       FROM users u
       LEFT JOIN shops s ON u.shop_id = s.id
       WHERE u.email = $1`,
      [email],
    );
  }

  findByIdWithShop(id: number): Promise<User | null> {
    return this.db.queryOne<User>(
      `SELECT u.*, s.is_active AS shop_is_active
       FROM users u
       LEFT JOIN shops s ON u.shop_id = s.id
       WHERE u.id = $1`,
      [id],
    );
  }

  async insertUser(
    name: string,
    email: string,
    passwordHash: string,
    role: UserRole,
    shopId: number | null,
    client?: PoolClient,
  ): Promise<User> {
    const sql = `
      INSERT INTO users (name, email, password_hash, role, shop_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, email, role, shop_id, is_active, created_at, updated_at
    `;
    const params: unknown[] = [name, email, passwordHash, role, shopId];

    if (client) {
      const result = await client.query<User>(sql, params);
      return result.rows[0];
    }

    const rows = await this.db.query<User>(sql, params);
    return rows[0];
  }

  // shopIdScope: when provided, results are restricted to that shop (used for SHOP_OWNER)
  async findPaginated(
    query: UserQueryDto,
    shopIdScope?: number,
  ): Promise<{ data: SafeUser[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (shopIdScope !== undefined) {
      conditions.push(`u.shop_id = $${idx++}`);
      params.push(shopIdScope);
    }
    if (query.shop_id !== undefined) {
      conditions.push(`u.shop_id = $${idx++}`);
      params.push(query.shop_id);
    }
    if (query.role) {
      conditions.push(`u.role = $${idx++}`);
      params.push(query.role);
    }
    if (query.search) {
      // Both name and email share the same $idx — push only once
      conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx})`);
      params.push(`%${query.search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(query.limit, query.offset);
    const limitIdx = idx++;
    const offsetIdx = idx;

    const rows = await this.db.query<SafeUser & { total_count: string }>(
      `SELECT u.id, u.shop_id, s.name AS shop_name, u.name, u.email, u.role,
              u.is_active, u.created_at, u.updated_at,
              COUNT(*) OVER() AS total_count
       FROM users u
       LEFT JOIN shops s ON u.shop_id = s.id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      data: rows.map(({ total_count: _, ...u }) => u as SafeUser),
      total: rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  // shopIdScope restricts lookup to a specific shop (used for SHOP_OWNER)
  findById(id: number, shopIdScope?: number): Promise<SafeUser | null> {
    const conditions = [`u.id = $1`];
    const params: unknown[] = [id];

    if (shopIdScope !== undefined) {
      conditions.push(`u.shop_id = $2`);
      params.push(shopIdScope);
    }

    return this.db.queryOne<SafeUser>(
      `SELECT u.id, u.shop_id, s.name AS shop_name, u.name, u.email, u.role,
              u.is_active, u.created_at, u.updated_at
       FROM users u
       LEFT JOIN shops s ON u.shop_id = s.id
       WHERE ${conditions.join(' AND ')}`,
      params,
    );
  }

  async update(
    id: number,
    data: { name?: string; email?: string },
  ): Promise<SafeUser | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      params.push(data.name);
    }
    if (data.email !== undefined) {
      fields.push(`email = $${idx++}`);
      params.push(data.email);
    }

    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const rows = await this.db.query<SafeUser>(
      `UPDATE users
       SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING id, shop_id, name, email, role, is_active, created_at, updated_at`,
      params,
    );
    return rows[0] ?? null;
  }

  async deactivate(id: number): Promise<SafeUser | null> {
    const rows = await this.db.query<SafeUser>(
      `UPDATE users
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1
       RETURNING id, shop_id, name, email, role, is_active, created_at, updated_at`,
      [id],
    );
    return rows[0] ?? null;
  }

  async activate(id: number): Promise<SafeUser | null> {
    const rows = await this.db.query<SafeUser>(
      `UPDATE users
       SET is_active = TRUE, updated_at = NOW()
       WHERE id = $1
       RETURNING id, shop_id, name, email, role, is_active, created_at, updated_at`,
      [id],
    );
    return rows[0] ?? null;
  }
}
