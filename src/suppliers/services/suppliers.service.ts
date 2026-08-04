import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { SuppliersRepository } from '../repositories/suppliers.repository';
import { Supplier, SupplierListItem } from '../entities/supplier.entity';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { SupplierQueryDto } from '../dto/supplier-query.dto';
import { CreateSupplierDebtDto } from '../dto/create-supplier-debt.dto';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DebtsService } from '../../debts/services/debts.service';
import { Debt, DebtListItem, DebtsSummary } from '../../debts/entities/debt.entity';
import { DebtQueryDto } from '../../debts/dto/debt-query.dto';
import { DatabaseService } from '../../database/database.service';
import { toMinor, fromMinor } from '../../common/utils/money.util';

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
  constructor(
    private readonly suppliersRepo: SuppliersRepository,
    private readonly debtsService: DebtsService,
    private readonly db: DatabaseService,
  ) {}

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
   * Records a bill from this supplier. Mirrors how a credit sale works in
   * `ReceiptsService.create`: the debt's total is the *whole* bill, and
   * whatever was already paid becomes the first collection, not a smaller
   * starting total — so the history always shows the real bill size next to
   * the real payment.
   */
  async createDebt(
    id: number,
    dto: CreateSupplierDebtDto,
    user: RequestUser,
  ): Promise<Debt & { remaining: string }> {
    const supplier = await this.requireOwnSupplier(id, user);

    // Pre-check for a clean, translatable error; the partial unique index
    // (idx_debts_supplier_invoice_unique) is still the real guard against a
    // concurrent insert.
    if (dto.invoiceNo) {
      const exists = await this.suppliersRepo.hasInvoice(id, dto.invoiceNo);
      if (exists) throw new ConflictException('supplier.INVOICE_TAKEN');
    }

    const totalMinor = toMinor(dto.totalAmount);
    const paidMinor = dto.paidAmount !== undefined ? toMinor(dto.paidAmount) : 0n;

    if (paidMinor > totalMinor) {
      throw new BadRequestException({
        key: 'supplier.PAID_EXCEEDS_TOTAL',
        args: { total: fromMinor(totalMinor) },
      });
    }

    const created = await this.db.transaction(async (client) => {
      const debt = await this.debtsService.createDebt(
        {
          kind: 'SUPPLIER_INVOICE',
          supplierId: id,
          debtorShopId: supplier.shop_id,
          totalAmount: dto.totalAmount,
          invoiceNo: dto.invoiceNo,
          note: dto.note,
          createdBy: user.id,
        },
        client,
      );

      if (paidMinor > 0n) {
        await this.debtsService.addPayment(
          debt.id,
          { amount: fromMinor(paidMinor), note: dto.note, createdBy: user.id },
          client,
        );
      }

      return debt;
    });

    // Re-fetch after the transaction: `created` still shows paid_amount from
    // before the payment above was applied.
    return this.debtsService.findByIdForUser(created.id, user);
  }

  async findDebts(
    id: number,
    query: DebtQueryDto,
    user: RequestUser,
  ): Promise<PaginatedResponse<DebtListItem>> {
    await this.requireOwnSupplier(id, user);
    // findAll re-applies role visibility on top, so the supplier filter can
    // only narrow what this user was already allowed to see.
    return this.debtsService.findAll({ ...query, supplierId: id } as DebtQueryDto, user, 'SUPPLIER');
  }

  async getSummary(id: number, user: RequestUser): Promise<DebtsSummary> {
    await this.requireOwnSupplier(id, user);
    return this.debtsService.getSupplierSummary(id);
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
