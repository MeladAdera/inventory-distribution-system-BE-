import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { SuppliersRepository } from '../repositories/suppliers.repository';
import { Supplier, SupplierListItem } from '../entities/supplier.entity';
import { SupplierDebtItemDetail } from '../entities/supplier-debt-item.entity';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { SupplierQueryDto } from '../dto/supplier-query.dto';
import { CreateSupplierDebtDto, SupplierDebtItemDto } from '../dto/create-supplier-debt.dto';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { ShiftsService } from '../../shifts/services/shifts.service';
import { DebtsService } from '../../debts/services/debts.service';
import { Debt, DebtListItem, DebtsSummary, DebtPaymentAllocation } from '../../debts/entities/debt.entity';
import { DebtQueryDto } from '../../debts/dto/debt-query.dto';
import { CreateSupplierPaymentDto } from '../../debts/dto/create-supplier-payment.dto';
import { DatabaseService } from '../../database/database.service';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
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
    private readonly inventoryRepo: InventoryRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly shiftsService: ShiftsService,
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
  /**
   * Records a bill from a supplier, and — when the bill lists goods — stocks
   * those goods into this shop's inventory in the same transaction.
   *
   * The two halves are inseparable on purpose: a delivery that raised a payable
   * but failed to land on the shelf (or vice versa) would leave the ledger and
   * the cost basis permanently disagreeing, with nothing in the data to say
   * which one is wrong.
   */
  async createDebt(
    id: number,
    dto: CreateSupplierDebtDto,
    user: RequestUser,
  ): Promise<Debt & { remaining: string; items: SupplierDebtItemDetail[] }> {
    const supplier = await this.requireOwnSupplier(id, user);

    // Raising a *new* bill against a supplier the shop has retired is almost
    // always a mis-selected id. Reads and payments deliberately stay open on a
    // deactivated supplier — history has to remain legible, and money already
    // owed has to stay payable — so this guard lives here rather than in
    // requireOwnSupplier.
    if (!supplier.is_active) {
      throw new BadRequestException('supplier.INACTIVE');
    }

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

    // Everything that can be rejected without touching the database is rejected
    // before the transaction opens, so a bad line never holds inventory row
    // locks while the request unwinds.
    const items = dto.items ? await this.resolveItems(dto.items, totalMinor, supplier.shop_id) : [];

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

      for (const item of items) {
        // The same call the orders flow makes on delivery
        // (orders.service.ts:312): blends this batch's cost into the shop's
        // moving average, or seeds a fresh inventory row from it when the shop
        // has never carried the product. The cost is always stated — never
        // inherited — because an invoice knows what it charged.
        const inventory = await this.inventoryRepo.upsertStockIn(
          supplier.shop_id,
          item.productId,
          item.quantity,
          Number(item.unitCost),
          client,
        );

        await this.suppliersRepo.insertDebtItem(
          {
            debtId: debt.id,
            productId: item.productId,
            inventoryId: inventory.id,
            quantity: item.quantity,
            unitCost: item.unitCost,
          },
          client,
        );

        await this.auditLogsService.log(
          {
            shop_id: supplier.shop_id,
            user_id: user.id,
            type: 'INVENTORY',
            action: 'STOCK_IN',
            entity_type: 'inventory',
            entity_id: inventory.id,
            quantity: item.quantity,
            amount: Number(fromMinor(BigInt(item.quantity) * toMinor(item.unitCost))),
            notes: dto.invoiceNo
              ? {
                  key: 'audit-logs.NOTE_SUPPLIER_INVOICE',
                  args: { supplier: supplier.name, invoiceNo: dto.invoiceNo },
                }
              : { key: 'audit-logs.NOTE_SUPPLIER_PURCHASE', args: { supplier: supplier.name } },
          },
          client,
        );
      }

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
    // before the payment above was applied. The lines come back with the
    // resulting avg_cost, so the caller can show what each purchase did to the
    // cost basis without a second round trip.
    const debt = await this.debtsService.findByIdForUser(created.id, user);
    const lines = items.length > 0 ? await this.suppliersRepo.findDebtItems(created.id) : [];

    return { ...debt, items: lines };
  }

  /**
   * The goods on one bill. Reads `avg_cost` live, so the screen shows today's
   * basis rather than the one this delivery happened to produce.
   */
  async findDebtItems(
    id: number,
    debtId: number,
    user: RequestUser,
  ): Promise<SupplierDebtItemDetail[]> {
    await this.requireOwnSupplier(id, user);

    // Reuses the debt engine's own visibility rules, then confirms the bill
    // really belongs to the supplier in the path — otherwise the supplier id
    // would be decorative and any visible debt could be read through any of
    // this shop's suppliers.
    const debt = await this.debtsService.findByIdForUser(debtId, user);
    if (debt.supplier_id !== id) throw new NotFoundException('debt.NOT_FOUND');

    return this.suppliersRepo.findDebtItems(debtId);
  }

  /**
   * Validates the invoice lines against the catalog and against the bill's own
   * total, and returns them in a lock-safe order.
   */
  private async resolveItems(
    items: SupplierDebtItemDto[],
    totalMinor: bigint,
    shopId: number,
  ): Promise<SupplierDebtItemDto[]> {
    const productIds = items.map((item) => item.productId);

    // Two lines for one product would blend the average twice from a stale
    // base and leave the invoice with no single per-unit cost. Merging them is
    // the client's job — guessing here would hide a keying mistake.
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException('supplier.DUPLICATE_ITEM');
    }

    const products = await this.inventoryRepo.findProductsForStockIn(productIds);
    const byId = new Map(products.map((product) => [product.id, product]));

    for (const item of items) {
      // Strictly positive. The column CHECK would catch this too, but only as a
      // raw constraint violation; MONEY_PATTERN cannot express it because '0'
      // is a perfectly well-formed money string.
      if (toMinor(item.unitCost) <= 0n) {
        throw new BadRequestException({
          key: 'supplier.ITEM_COST_INVALID',
          args: { productId: item.productId },
        });
      }

      const product = byId.get(item.productId);

      // Same two guards as InventoryService.stockIn, per line. Without the
      // scope check a shop could stock another shop's private (LOCAL) product
      // onto its own shelves through the invoice route.
      if (!product) {
        throw new NotFoundException({
          key: 'inventory.PRODUCT_NOT_FOUND',
          args: { productId: item.productId },
        });
      }
      if (product.shop_id !== shopId && product.source !== 'WAREHOUSE') {
        throw new ForbiddenException('inventory.PRODUCT_NOT_IN_SCOPE');
      }
    }

    // Summed in bigint minor units, never floats: 3 x 0.10 must be exactly 0.30
    // or the reconciliation below would reject perfectly good invoices.
    const linesMinor = items.reduce(
      (sum, item) => sum + BigInt(item.quantity) * toMinor(item.unitCost),
      0n,
    );

    if (linesMinor !== totalMinor) {
      throw new BadRequestException({
        key: 'supplier.ITEMS_TOTAL_MISMATCH',
        args: { itemsTotal: fromMinor(linesMinor), total: fromMinor(totalMinor) },
      });
    }

    // Sorted by product id so two invoices touching overlapping products take
    // the inventory row locks in the same order and cannot deadlock each other.
    return [...items].sort((a, b) => a.productId - b.productId);
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

  async addPayment(
    id: number,
    dto: CreateSupplierPaymentDto,
    user: RequestUser,
  ): Promise<DebtPaymentAllocation[]> {
    const supplier = await this.requireOwnSupplier(id, user);

    // Cash out, and only the person paying knows whether it came from the till
    // or the safe. Guessing the open shift would make whoever is on it look
    // short by this amount for money they never touched, so nothing is assumed:
    // no id means it belongs to no shift.
    const shiftSessionId = await this.shiftsService.resolveExplicit(
      supplier.shop_id,
      dto.shiftSessionId,
    );

    return this.debtsService.addSupplierPayment(id, supplier.shop_id, dto, user.id, shiftSessionId);
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
