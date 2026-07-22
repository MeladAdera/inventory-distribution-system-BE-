import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface PasswordResetCode {
  id: bigint;
  user_id: number;
  code_hash: string;
  expires_at: Date;
  created_at: Date;
  used_at: Date | null;
}

@Injectable()
export class PasswordResetCodesRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(
    userId: number,
    codeHash: string,
    expiresAt: Date,
  ): Promise<PasswordResetCode> {
    const rows = await this.db.query<PasswordResetCode>(
      `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, codeHash, expiresAt],
    );
    return rows[0];
  }

  findValid(userId: number, codeHash: string): Promise<PasswordResetCode | null> {
    return this.db.queryOne<PasswordResetCode>(
      `SELECT * FROM password_reset_codes
       WHERE user_id = $1
         AND code_hash = $2
         AND used_at IS NULL
         AND expires_at > NOW()`,
      [userId, codeHash],
    );
  }

  async markUsed(id: bigint): Promise<void> {
    await this.db.execute(
      `UPDATE password_reset_codes SET used_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  async invalidateAllForUser(userId: number): Promise<void> {
    await this.db.execute(
      `UPDATE password_reset_codes
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
  }
}
