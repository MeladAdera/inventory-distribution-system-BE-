import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { SuppliersRepository } from '../repositories/suppliers.repository';
import { Supplier, SupplierListItem } from '../entities/supplier.entity';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { SupplierQueryDto } from '../dto/supplier-query.dto';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

/**
 * Suppliers belong to a shop, not the whole warehouse network — every method
 * resolves the shop straight from the caller. Unlike Customers, both
 * WAREHOUSE_ADMIN and SHOP_OWNER reach this service: the warehouse buys from
 * its own distribution centers exactly like a shop buys from its own local
 * suppliers, scoped to its own `shopId` the same way `stockIn` is. Neither
 * role gets a cross-shop view — a shop's suppliers are its own business,
 * same rule as Customers, just extended to cover the warehouse too.
 */
@Injectable()
export class SuppliersService {
  constructor(private readonly suppliersRepo: SuppliersRepository) {}

  async create(dto: CreateSupplierDto, user: RequestUser): Promise<Supplier> {
    const shopId = user.shopId!;

    // Pre-check for a clean, translatable error; the partial unique index is
    // still the real guard against a concurrent insert.
    if (dto.phone) {
      const existing = await this.suppliersRepo.findActiveByPhone(shopId, dto.phone);
      if (existing) throw new ConflictException('supplier.PHONE_TAKEN');
    }

    return this.suppliersRepo.insert(shopId, dto);
  }

  async findAll(query: SupplierQueryDto, user: RequestUser): Promise<PaginatedResponse<SupplierListItem>> {
    const result = await this.suppliersRepo.findPaginated(user.shopId!, query);
    return paginate(result.data, query.page, query.limit, result.total);
  }

  findById(id: number, user: RequestUser): Promise<Supplier> {
    return this.requireOwnSupplier(id, user);
  }

  async update(id: number, dto: UpdateSupplierDto, user: RequestUser): Promise<Supplier> {
    const supplier = await this.requireOwnSupplier(id, user);

    if (dto.phone) {
      const existing = await this.suppliersRepo.findActiveByPhone(supplier.shop_id, dto.phone, id);
      if (existing) throw new ConflictException('supplier.PHONE_TAKEN');
    }

    const updated = await this.suppliersRepo.update(id, dto);
    if (!updated) throw new NotFoundException('supplier.NOT_FOUND');

    return updated;
  }

  /**
   * Soft delete. Blocked while the supplier is still owed money, and equally
   * while they owe the shop back from a bill that was cancelled after being
   * paid — deactivating in either case would drop a real balance off the
   * active list.
   */
  async deactivate(id: number, user: RequestUser): Promise<Supplier> {
    await this.requireOwnSupplier(id, user);

    if (await this.suppliersRepo.hasBlockingDebt(id)) {
      throw new BadRequestException('supplier.HAS_OPEN_DEBT');
    }

    const deactivated = await this.suppliersRepo.deactivate(id);
    if (!deactivated) throw new NotFoundException('supplier.NOT_FOUND');

    return deactivated;
  }

  /**
   * Looks the supplier up already scoped to the caller's shop, so another
   * shop's supplier is a 404 rather than a 403 — the id's existence is not
   * information this caller is entitled to.
   */
  private async requireOwnSupplier(id: number, user: RequestUser): Promise<Supplier> {
    const supplier = await this.suppliersRepo.findByIdInShop(id, user.shopId!);
    if (!supplier) throw new NotFoundException('supplier.NOT_FOUND');

    return supplier;
  }
}
