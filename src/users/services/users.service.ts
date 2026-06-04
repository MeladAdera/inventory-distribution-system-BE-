import { Injectable, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../database/database.service';
import { UsersRepository } from '../repositories/users.repository';
import { User } from '../entities/user.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { CreateShopOwnerDto } from '../dto/create-shop-owner.dto';
import { CreateEmployeeDto } from '../dto/create-employee.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly db: DatabaseService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findByEmail(email);
  }

  async createShopOwner(dto: CreateShopOwnerDto): Promise<User> {
    const existing = await this.usersRepo.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.db.transaction(async (client) => {
      // shop insert lives here until ShopsRepository is built
      const shopResult = await client.query<{ id: number }>(
        `INSERT INTO shops (name, address, type) VALUES ($1, $2, 'SHOP') RETURNING id`,
        [dto.shopName, dto.shopAddress ?? ''],
      );
      const shopId = shopResult.rows[0].id;

      return this.usersRepo.insertUser(
        dto.ownerName, dto.email, passwordHash, UserRole.SHOP_OWNER, shopId, client,
      );
    });
  }

  async createEmployee(
    dto: CreateEmployeeDto,
    owner: { id: number; shopId: number },
  ): Promise<User> {
    const existing = await this.usersRepo.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.usersRepo.insertUser(
      dto.name, dto.email, passwordHash, UserRole.EMPLOYEE, owner.shopId,
    );
  }
}
