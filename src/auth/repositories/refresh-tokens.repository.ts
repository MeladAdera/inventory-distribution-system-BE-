import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface RefreshToken {
  id: bigint;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
}

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(
    userId: number,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    const rows = await this.db.query<RefreshToken>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, tokenHash, expiresAt],
    );
    return rows[0];
  }

  findValid(tokenHash: string): Promise<RefreshToken | null> {
    return this.db.queryOne<RefreshToken>(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [tokenHash],
    );
  }

  // Looks up a token regardless of revoked/expired state — used to detect reuse
  // of an already-rotated (revoked) token.
  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.db.queryOne<RefreshToken>(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
  }

  async revoke(id: bigint): Promise<void> {
    await this.db.execute(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.db.execute(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  /**
   * Atomically revoke the old token and insert the new one.
   * If either step fails the transaction rolls back — the caller's
   * existing token stays valid and no phantom row is created.
   */
  async rotate(
    oldId: bigint,
    userId: number,
    newTokenHash: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
        [oldId],
      );

      const result = await client.query<RefreshToken>(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [userId, newTokenHash, expiresAt],
      );

      return result.rows[0];
    });
  }
}
