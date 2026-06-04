import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Shop } from '../entities/shop.entity';
import { UpdateShopDto } from '../dto/update-shop.dto';

@Injectable()
export class ShopsRepository {
  constructor(private readonly db: DatabaseService) {}

  findAll(): Promise<Shop[]> {
    return this.db.query<Shop>(
      'SELECT id, name, address, phone, type, is_active, created_at, updated_at FROM shops ORDER BY id',
    );
  }

  findById(id: number): Promise<Shop | null> {
    return this.db.queryOne<Shop>(
      'SELECT id, name, address, phone, type, is_active, created_at, updated_at FROM shops WHERE id = $1',
      [id],
    );
  }

  async update(id: number, dto: UpdateShopDto): Promise<Shop> {
    // Build SET clause dynamically from only the fields that were provided
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined)    { fields.push(`name = $${idx++}`);    values.push(dto.name); }
    if (dto.address !== undefined) { fields.push(`address = $${idx++}`); values.push(dto.address); }
    if (dto.phone !== undefined)   { fields.push(`phone = $${idx++}`);   values.push(dto.phone); }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const rows = await this.db.query<Shop>(
      `UPDATE shops SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, name, address, phone, type, is_active, created_at, updated_at`,
      values,
    );
    return rows[0];
  }

  async updateStatus(id: number, isActive: boolean): Promise<Shop> {
    const rows = await this.db.query<Shop>(
      `UPDATE shops SET is_active = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, name, address, phone, type, is_active, created_at, updated_at`,
      [isActive, id],
    );
    return rows[0];
  }
}
