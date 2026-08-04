import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ReceiptsRepository, ReceiptItemInsert } from '../repositories/receipts.repository';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { DebtsService } from '../../debts/services/debts.service';
import { CustomersRepository } from '../../customers/repositories/customers.repository';
import { CreateReceiptDto } from '../dto/create-receipt.dto';
import { ReceiptQueryDto } from '../dto/receipt-query.dto';
import { ReceiptWithItems, ReceiptListItem } from '../entities/receipt.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { toMinor, fromMinor } from '../../common/utils/money.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly receiptsRepo: ReceiptsRepository,
    private readonly inventoryRepo: InventoryRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationsService: NotificationsService,
    private readonly debtsService: DebtsService,
    private readonly customersRepo: CustomersRepository,
    private readonly db: DatabaseService,
  ) {}

  async create(dto: CreateReceiptDto, user: RequestUser): Promise<ReceiptWithItems> {
    const shopId = user.shopId!;
    const inventoryIds = dto.items.map((i) => i.inventoryId);

    const uniqueIds = new Set(inventoryIds);
    if (uniqueIds.size !== inventoryIds.length) {
      throw new BadRequestException('receipt.DUPLICATE_INVENTORY_IDS');
    }

    // Validated before the transaction opens so a bad customer id never holds
    // inventory locks. Scoped to the shop: another shop's customer is a 404.
    if (dto.customerId !== undefined) {
      const customer = await this.customersRepo.findByIdInShop(dto.customerId, shopId);
      if (!customer) throw new NotFoundException('customer.NOT_FOUND');
    }

    const { receiptId, lowStockItems } = await this.db.transaction(async (client) => {
      // Lock all inventory rows for the duration of this transaction
      const inventoryRows = await this.inventoryRepo.findByIdsForUpdate(inventoryIds, client);

      if (inventoryRows.length !== dto.items.length) {
        throw new NotFoundException('receipt.INVENTORY_NOT_FOUND');
      }

      const inventoryMap = new Map(inventoryRows.map((r) => [r.id, r]));
      const itemInserts: ReceiptItemInsert[] = [];
      const lowStockItems: { product_name: string }[] = [];

      for (const item of dto.items) {
        const inv = inventoryMap.get(item.inventoryId)!;

        if (inv.shop_id !== shopId) {
          throw new ForbiddenException('inventory.ACCESS_DENIED');
        }

        const quantityAfter = inv.current_quantity - item.quantity;
        if (quantityAfter < 0) {
          throw new BadRequestException({
            key: 'receipt.NEGATIVE_STOCK',
            args: { product: inv.product_name, current: inv.current_quantity, required: item.quantity },
          });
        }

        itemInserts.push({
          inventoryId: item.inventoryId,
          productId: inv.product_id,
          quantity: item.quantity,
          // Snapshot the shop's own selling price and moving-average cost at
          // sale time — the basis profit reports use (receipt_items.price/.cost_price).
          price: inv.sale_price,
          costPrice: inv.avg_cost,
          quantityBefore: inv.current_quantity,
          quantityAfter,
        });

        if (quantityAfter <= inv.low_stock_threshold) {
          lowStockItems.push({ product_name: inv.product_name });
        }
      }

      // The sale total, summed in bigint minor units from the same price
      // snapshots the items are written with — so the figure the debt is based
      // on is exactly the figure the receipt charges, with no float in between.
      const totalMinor = itemInserts.reduce(
        (sum, item) => sum + toMinor(item.price) * BigInt(item.quantity),
        0n,
      );
      const paidMinor = dto.paidAmount !== undefined ? toMinor(dto.paidAmount) : totalMinor;

      if (paidMinor > totalMinor) {
        throw new BadRequestException({
          key: 'receipt.PAID_EXCEEDS_TOTAL',
          args: { total: fromMinor(totalMinor) },
        });
      }

      // Somebody has to owe the balance. An anonymous debt could never be
      // collected, so the sale is rejected rather than silently written off.
      if (paidMinor < totalMinor && dto.customerId === undefined) {
        throw new BadRequestException('receipt.CUSTOMER_REQUIRED');
      }

      // Insert receipt header
      const receipt = await this.receiptsRepo.insertReceipt(shopId, user.id, dto.notes, dto.customerId, client);

      // Apply each inventory adjustment
      for (const item of dto.items) {
        const adjusted = await this.inventoryRepo.adjust(item.inventoryId, -item.quantity, client);
        if (!adjusted) {
          // Guard: should be unreachable because rows are locked and we validated above
          throw new BadRequestException('receipt.NEGATIVE_STOCK');
        }
      }

      // Batch-insert receipt items
      await this.receiptsRepo.insertItems(receipt.id, itemInserts, client);

      // One audit log entry per item
      for (const insert of itemInserts) {
        await this.auditLogsService.log(
          {
            shop_id: shopId,
            user_id: user.id,
            type: 'INVENTORY',
            action: 'ADJUSTMENT',
            entity_type: 'inventory',
            entity_id: insert.inventoryId,
            receipt_id: receipt.id,
            quantity: -insert.quantity,
            notes: dto.notes,
          },
          client,
        );
      }

      // A credit sale: the debt carries the whole sale as its total, with what
      // was handed over recorded as the first collection. Storing only the
      // unpaid part would lose how much the sale was actually worth.
      if (paidMinor < totalMinor) {
        const debt = await this.debtsService.createDebt(
          {
            kind: 'RECEIPT',
            creditorShopId: shopId,
            customerId: dto.customerId!,
            receiptId: receipt.id,
            totalAmount: fromMinor(totalMinor),
            createdBy: user.id,
            note: `Receipt #${receipt.id}`,
          },
          client,
        );

        if (paidMinor > 0n) {
          await this.debtsService.addPayment(
            debt.id,
            { amount: fromMinor(paidMinor), note: dto.notes, createdBy: user.id },
            client,
          );
        }
      }

      return { receiptId: receipt.id, lowStockItems };
    });


    // Fire-and-forget low stock notifications after the transaction commits
    for (const item of lowStockItems) {
      this.notificationsService
        .notifyLowStock(item.product_name, shopId)
        .catch((err: unknown) => this.logger.error('notifyLowStock failed', err));
    }

    return this.withDebt(receiptId);
  }

  async findAll(user: RequestUser, query: ReceiptQueryDto): Promise<PaginatedResponse<ReceiptListItem>> {
    const scopedShopId = user.role === UserRole.WAREHOUSE_ADMIN ? undefined : user.shopId!;
    const result = await this.receiptsRepo.findPaginated(query, scopedShopId);
    return paginate(result.data, query.page, query.limit, result.total);
  }

  async findById(id: number, user: RequestUser): Promise<ReceiptWithItems> {
    const receipt = await this.receiptsRepo.findById(id);
    if (!receipt) throw new NotFoundException('receipt.NOT_FOUND');

    if (user.role !== UserRole.WAREHOUSE_ADMIN && receipt.shop_id !== user.shopId) {
      throw new ForbiddenException('receipt.ACCESS_DENIED');
    }

    return this.attachDebt(receipt);
  }

  async setFree(id: number, isFree: boolean, user: RequestUser): Promise<ReceiptWithItems> {
    const receipt = await this.receiptsRepo.findById(id);
    if (!receipt) throw new NotFoundException('receipt.NOT_FOUND');

    if (user.role !== UserRole.WAREHOUSE_ADMIN && receipt.shop_id !== user.shopId) {
      throw new ForbiddenException('receipt.ACCESS_DENIED');
    }

    // "Free" and "owed for" are contradictory states. If money was already
    // collected against this sale, refuse rather than leave a payment pointing
    // at a sale that officially charged nothing; if nothing was collected, the
    // debt is simply void.
    const debt = isFree ? await this.debtsService.findBySource({ type: 'RECEIPT', id }) : null;
    if (debt && toMinor(debt.paid_amount) > 0n) {
      throw new BadRequestException('debt.HAS_PAYMENTS');
    }

    // Flip the flag and write the audit trail in one transaction. The UPDATE is
    // conditional on the value actually changing, so if the receipt is already
    // in the requested state (or a concurrent request just set it), we log
    // nothing — no duplicate audit entries and no partial write.
    await this.db.transaction(async (client) => {
      const changed = await this.receiptsRepo.setIsFree(id, isFree, client);
      if (!changed) return;

      if (debt) {
        await this.debtsService.cancelDebt(
          { type: 'RECEIPT', id },
          user.id,
          `Receipt #${id} marked free`,
          client,
        );
      }

      // One audit log entry per item — same INVENTORY type as receipt creation,
      // so product_name resolves via the entity_id -> inventory -> product join.
      const action = isFree ? 'MARKED_FREE' : 'UNMARKED_FREE';
      for (const item of receipt.items) {
        await this.auditLogsService.log(
          {
            shop_id: receipt.shop_id,
            user_id: user.id,
            type: 'INVENTORY',
            action,
            entity_type: 'inventory',
            entity_id: item.inventory_id,
            receipt_id: id,
            amount: item.quantity * parseFloat(item.price),
            notes: receipt.notes ?? undefined,
          },
          client,
        );
      }
    });

    return this.withDebt(id);
  }

  async cancel(id: number, reason: string | undefined, user: RequestUser): Promise<ReceiptWithItems> {
    const receipt = await this.receiptsRepo.findById(id);
    if (!receipt) throw new NotFoundException('receipt.NOT_FOUND');

    if (user.role !== UserRole.WAREHOUSE_ADMIN && receipt.shop_id !== user.shopId) {
      throw new ForbiddenException('receipt.ACCESS_DENIED');
    }
    if (receipt.is_cancelled) {
      throw new BadRequestException('receipt.ALREADY_CANCELLED');
    }

    await this.db.transaction(async (client) => {
      // Conditional UPDATE (is_cancelled = FALSE) is the real guard against a
      // race with a concurrent cancel — only the request that flips the flag
      // proceeds to restore stock, so stock can never be double-restored.
      const cancelled = await this.receiptsRepo.cancel(id, user.id, reason, client);
      if (!cancelled) {
        throw new ConflictException('receipt.ALREADY_CANCELLED');
      }

      for (const item of receipt.items) {
        const restored = await this.inventoryRepo.adjust(item.inventory_id, item.quantity, client);
        if (!restored) {
          // Guard: should be unreachable — a positive delta can't fail the
          // current_quantity + delta >= 0 check, and the FK cascade means the
          // inventory row can't be gone while this receipt_item still exists.
          throw new BadRequestException('receipt.RESTORE_FAILED');
        }
        await this.auditLogsService.log(
          {
            shop_id: receipt.shop_id,
            user_id: user.id,
            type: 'INVENTORY',
            action: 'CANCELLED',
            entity_type: 'inventory',
            entity_id: item.inventory_id,
            receipt_id: id,
            quantity: item.quantity,
            amount: item.quantity * parseFloat(item.price),
            notes: reason,
          },
          client,
        );
      }

      // Same transaction as the stock restore: the sale is undone, so what was
      // owed for it is too. Collected money stays on the ledger and surfaces as
      // refund_due rather than disappearing.
      await this.debtsService.cancelDebt(
        { type: 'RECEIPT', id },
        user.id,
        reason ?? `Receipt #${id} cancelled`,
        client,
      );
    });

    return this.withDebt(id);
  }

  private async withDebt(id: number): Promise<ReceiptWithItems> {
    const receipt = await this.receiptsRepo.findById(id);
    return this.attachDebt(receipt!);
  }

  /**
   * Folds the receivable side onto the receipt so a cashier sees "remaining
   * 50.00" on the sale itself, without a second request to /debts.
   */
  private async attachDebt(receipt: ReceiptWithItems): Promise<ReceiptWithItems> {
    const debt = await this.debtsService.findBySource({ type: 'RECEIPT', id: receipt.id });

    receipt.debt = debt
      ? {
          id: debt.id,
          total_amount: debt.total_amount,
          paid_amount: debt.paid_amount,
          remaining: fromMinor(toMinor(debt.total_amount) - toMinor(debt.paid_amount)),
          status: debt.status,
        }
      : null;

    return receipt;
  }
}
