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

  /**
   * Of the given ids, those that are active employees of this shop.
   *
   * Set-based on purpose: callers validating a roster hold a list, and asking
   * per id would be one round trip each. Returning the ids that *passed* lets
   * the caller name the one that failed, which is the difference between
   * "someone is not an employee" and a message the owner can act on.
   */
  async findActiveEmployeeIdsInShop(ids: number[], shopId: number): Promise<number[]> {
    if (ids.length === 0) return [];

    const rows = await this.db.query<{ id: number }>(
      `SELECT id
         FROM users
        WHERE id = ANY($1::int[])
          AND shop_id = $2
          AND role = $3
          AND is_active`,
      [ids, shopId, UserRole.EMPLOYEE],
    );

    return rows.map((row) => row.id);
  }

  async update(
    id: number,
    data: { name?: string; email?: string; password_hash?: string },
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
    if (data.password_hash !== undefined) {
      fields.push(`password_hash = $${idx++}`);
      params.push(data.password_hash);
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
