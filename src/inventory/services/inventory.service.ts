import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { InventoryRepository } from '../repositories/inventory.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { InventoryQueryDto } from '../dto/inventory-query.dto';
import { StockInDto } from '../dto/stock-in.dto';
import { AdjustInventoryDto } from '../dto/adjust-inventory.dto';
import { InventoryWithProduct } from '../entities/inventory.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventoryRepo: InventoryRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationsService: NotificationsService,
    private readonly db: DatabaseService,
  ) {}

  async findAll(user: RequestUser, query: InventoryQueryDto): Promise<PaginatedResponse<InventoryWithProduct>> {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      const result = await this.inventoryRepo.findAllForAdmin(query);
      return paginate(result.data, query.page, query.limit, result.total);
    }

    const result = await this.inventoryRepo.findPaginated(user.shopId!, query);
    return paginate(result.data, query.page, query.limit, result.total);
  }

  async findById(id: number, user: RequestUser): Promise<InventoryWithProduct> {
    const item = await this.inventoryRepo.findById(id);
    if (!item) throw new NotFoundException('Inventory record not found');

    this.assertReadAccess(user, item.shop_id);
    return item;
  }

  async stockIn(dto: StockInDto, user: RequestUser): Promise<InventoryWithProduct> {
    const shopId = user.shopId!;

    const result = await this.db.transaction(async (client) => {
      const updated = await this.inventoryRepo.upsertStockIn(shopId, dto.productId, dto.quantity, client);

      await this.auditLogsService.log(
        {
          shop_id: shopId,
          user_id: user.id,
          type: 'INVENTORY',
          action: 'STOCK_IN',
          entity_type: 'inventory',
          entity_id: updated.id,
          quantity: dto.quantity,
          notes: dto.notes,
        },
        client,
      );

      return this.inventoryRepo.findById(updated.id, client).then((r) => r!);
    });

    if (result.is_low_stock) {
      await this.notificationsService.notifyLowStock(result.product_name, shopId);
    }

    return result;
  }

  async adjust(id: number, dto: AdjustInventoryDto, user: RequestUser): Promise<InventoryWithProduct> {
    const item = await this.inventoryRepo.findById(id);
    if (!item) throw new NotFoundException('Inventory record not found');

    this.assertWriteAccess(user, item.shop_id);

    const newQuantity = item.current_quantity + dto.adjustment;
    if (newQuantity < 0) {
      throw new BadRequestException(
        `Adjustment would result in negative stock (current: ${item.current_quantity}, adjustment: ${dto.adjustment})`,
      );
    }

    const result = await this.db.transaction(async (client) => {
      const adjusted = await this.inventoryRepo.adjust(id, dto.adjustment, client);
      if (!adjusted) {
        throw new BadRequestException('Adjustment would result in negative stock');
      }

      await this.auditLogsService.log(
        {
          shop_id: item.shop_id,
          user_id: user.id,
          type: 'INVENTORY',
          action: 'ADJUSTMENT',
          entity_type: 'inventory',
          entity_id: id,
          quantity: dto.adjustment,
          notes: dto.reason,
        },
        client,
      );

      return this.inventoryRepo.findById(id, client).then((r) => r!);
    });

    if (result.is_low_stock) {
      await this.notificationsService.notifyLowStock(result.product_name, item.shop_id);
    }

    return result;
  }

  async getLowStock(user: RequestUser): Promise<InventoryWithProduct[]> {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      return this.inventoryRepo.findAllLowStockForAdmin();
    }
    return this.inventoryRepo.findLowStock(user.shopId!);
  }

  private assertReadAccess(user: RequestUser, shopId: number): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (user.shopId !== shopId) throw new ForbiddenException('You do not have access to this inventory record');
  }

  private assertWriteAccess(user: RequestUser, shopId: number): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (user.shopId !== shopId) throw new ForbiddenException('You can only modify inventory for your own shop');
  }
}
