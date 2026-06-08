import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../database/database.service';
import { UsersRepository } from '../repositories/users.repository';
import { User, SafeUser } from '../entities/user.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { CreateShopOwnerDto } from '../dto/create-shop-owner.dto';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly db: DatabaseService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findByEmail(email);
  }

  findByIdForAuth(id: number): Promise<User | null> {
    return this.usersRepo.findByIdWithShop(id);
  }

  async createShopOwner(dto: CreateShopOwnerDto): Promise<User> {
    const existing = await this.usersRepo.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.db.transaction(async (client) => {
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

  // ── Read ────────────────────────────────────────────────────────────────────

  async findAll(
    query: UserQueryDto,
    requestUser: RequestUser,
  ): Promise<PaginatedResponse<SafeUser>> {
    // SHOP_OWNER is always scoped to their own shop
    const shopIdScope =
      requestUser.role === UserRole.SHOP_OWNER
        ? (requestUser.shopId ?? undefined)
        : undefined;

    const { data, total } = await this.usersRepo.findPaginated(query, shopIdScope);
    return paginate(data, query.page, query.limit, total);
  }

  async findById(id: number, requestUser: RequestUser): Promise<SafeUser> {
    const shopIdScope =
      requestUser.role === UserRole.SHOP_OWNER
        ? (requestUser.shopId ?? undefined)
        : undefined;

    const user = await this.usersRepo.findById(id, shopIdScope);
    if (!user) throw new NotFoundException(`User with id ${id} not found`);
    return user;
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  async updateUser(
    id: number,
    dto: UpdateUserDto,
    requestUser: RequestUser,
  ): Promise<SafeUser> {
    // Resolve the target (also enforces shop scope for SHOP_OWNER)
    const target = await this.findById(id, requestUser);

    // SHOP_OWNER can only update employees, not other owners or admins
    if (
      requestUser.role === UserRole.SHOP_OWNER &&
      target.role !== UserRole.EMPLOYEE
    ) {
      throw new ForbiddenException('Shop owners can only update their employees');
    }

    // Guard email uniqueness when the email is being changed
    if (dto.email && dto.email !== target.email) {
      const existing = await this.usersRepo.findByEmail(dto.email);
      if (existing) throw new ConflictException('Email already in use');
    }

    const updated = await this.usersRepo.update(id, dto);
    // update() returns null only if no fields were provided — dto validation
    // guarantees at least one field, but guard defensively
    if (!updated) throw new BadRequestException('No fields to update');
    return updated;
  }

  // ── Deactivate ──────────────────────────────────────────────────────────────

  async deactivateUser(id: number, requestUser: RequestUser): Promise<SafeUser> {
    if (id === requestUser.id) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    // Resolve target (also enforces shop scope for SHOP_OWNER)
    const target = await this.findById(id, requestUser);

    // The warehouse admin account must stay active
    if (target.role === UserRole.WAREHOUSE_ADMIN) {
      throw new ForbiddenException('The warehouse admin account cannot be deactivated');
    }

    // SHOP_OWNER can only deactivate employees in their own shop
    if (
      requestUser.role === UserRole.SHOP_OWNER &&
      target.role !== UserRole.EMPLOYEE
    ) {
      throw new ForbiddenException('Shop owners can only deactivate their employees');
    }

    const deactivated = await this.usersRepo.deactivate(id);
    if (!deactivated) throw new NotFoundException(`User with id ${id} not found`);
    return deactivated;
  }
}
