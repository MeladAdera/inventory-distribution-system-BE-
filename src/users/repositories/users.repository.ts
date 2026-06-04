import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { User } from '../entities/user.entity';
import { UserRole } from '../../common/enums/user-role.enum';

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.db.queryOne<User>(
      'SELECT * FROM users WHERE email = $1',
      [email],
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
}
