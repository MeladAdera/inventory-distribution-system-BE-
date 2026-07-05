import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ReceiptsRepository, ReceiptItemInsert } from '../repositories/receipts.repository';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { CreateReceiptDto } from '../dto/create-receipt.dto';
import { ReceiptQueryDto } from '../dto/receipt-query.dto';
import { ReceiptWithItems, ReceiptListItem } from '../entities/receipt.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly receiptsRepo: ReceiptsRepository,
    private readonly inventoryRepo: InventoryRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationsService: NotificationsService,
    private readonly db: DatabaseService,
  ) {}

  async create(dto: CreateReceiptDto, user: RequestUser): Promise<ReceiptWithItems> {
    const shopId = user.shopId!;
    const inventoryIds = dto.items.map((i) => i.inventoryId);

    const uniqueIds = new Set(inventoryIds);
    if (uniqueIds.size !== inventoryIds.length) {
      throw new BadRequestException('receipt.DUPLICATE_INVENTORY_IDS');
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
          price: inv.price,
          costPrice: inv.cost_price,
          quantityBefore: inv.current_quantity,
          quantityAfter,
        });

        if (quantityAfter <= inv.low_stock_threshold) {
          lowStockItems.push({ product_name: inv.product_name });
        }
      }

      // Insert receipt header
      const receipt = await this.receiptsRepo.insertReceipt(shopId, user.id, dto.notes, client);

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
            quantity: -insert.quantity,
            notes: `Receipt #${receipt.id}`,
          },
          client,
        );
      }

      return { receiptId: receipt.id, lowStockItems };
    });

    // Fire-and-forget low stock notifications after the transaction commits
    for (const item of lowStockItems) {
      this.notificationsService
        .notifyLowStock(item.product_name, shopId)
        .catch((err: unknown) => this.logger.error('notifyLowStock failed', err));
    }

    return this.receiptsRepo.findById(receiptId).then((r) => r!);
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

    return receipt;
  }
}
