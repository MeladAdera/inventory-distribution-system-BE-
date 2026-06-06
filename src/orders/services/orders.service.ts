import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { OrdersRepository } from '../repositories/orders.repository';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { OrderQueryDto } from '../dto/order-query.dto';
import { Order, OrderWithItems, OrderStatus } from '../entities/order.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';

export interface RequestUser {
  id: number;
  role: UserRole;
  shopId: number | null;
}

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: 'PROCESSING',
  PROCESSING: 'SHIPPED',
  SHIPPED: 'RECEIVED',
  RECEIVED: 'COMPLETED',
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepo: OrdersRepository,
    private readonly inventoryRepo: InventoryRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly db: DatabaseService,
  ) {}

  async createOrder(dto: CreateOrderDto, user: RequestUser): Promise<Order> {
    const toShopId = user.shopId!;

    const warehouse = await this.ordersRepo.findWarehouseShop();
    if (!warehouse) throw new BadRequestException('Warehouse not found');

    const productIds = dto.items.map((i) => i.productId);
    const hasDuplicates = new Set(productIds).size !== productIds.length;
    if (hasDuplicates) throw new BadRequestException('Duplicate products in order');

    for (const item of dto.items) {
      const inv = await this.inventoryRepo.findByShopAndProduct(warehouse.id, item.productId);
      if (!inv) {
        throw new BadRequestException(
          `Product ${item.productId} does not exist in warehouse inventory`,
        );
      }
    }

    const totalItems = dto.items.reduce((sum, i) => sum + i.quantity, 0);

    return this.db.transaction(async (client) => {
      const order = await this.ordersRepo.insert(warehouse.id, toShopId, totalItems, client);
      await this.ordersRepo.insertItems(order.id, dto.items, client);
      return order;
    });
  }

  async findAll(query: OrderQueryDto, user: RequestUser): Promise<PaginatedResponse<Order>> {
    const shopId = user.role === UserRole.WAREHOUSE_ADMIN ? undefined : user.shopId!;
    const result = await this.ordersRepo.findPaginated(query, shopId);
    return paginate(result.data, query.page, query.limit, result.total);
  }

  async findById(id: number, user: RequestUser): Promise<OrderWithItems> {
    const order = await this.ordersRepo.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    this.assertReadAccess(user, order);
    return order;
  }

  async updateStatus(id: number, dto: UpdateOrderStatusDto, user: RequestUser): Promise<Order> {
    const order = await this.ordersRepo.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    const expected = NEXT_STATUS[order.status];
    if (expected !== dto.status) {
      throw new BadRequestException(
        `Invalid transition: ${order.status} → ${dto.status}. Expected next status: ${expected ?? 'none (order is completed)'}`,
      );
    }

    return this.db.transaction(async (client) => {
      const updated = await this.ordersRepo.updateStatus(id, dto.status, client);

      await this.auditLogsService.log(
        {
          shop_id: null,
          user_id: user.id,
          type: 'ORDER',
          action: 'STATUS_CHANGED',
          entity_type: 'order',
          entity_id: id,
          notes: `${order.status} → ${dto.status}`,
        },
        client,
      );

      if (dto.status === 'RECEIVED') {
        await this.transferInventory(id, order.from_shop_id, order.to_shop_id, user.id, client);
      }

      return updated;
    });
  }

  private async transferInventory(
    orderId: number,
    warehouseShopId: number,
    toShopId: number,
    userId: number,
    client: import('pg').PoolClient,
  ): Promise<void> {
    const items = await this.ordersRepo.findItemsByOrderId(orderId, client);

    for (const item of items) {
      const warehouseInv = await this.inventoryRepo.findByShopAndProduct(
        warehouseShopId,
        item.product_id,
        client,
      );

      if (!warehouseInv) {
        throw new BadRequestException(
          `Warehouse inventory record missing for product ${item.product_id}`,
        );
      }

      if (warehouseInv.current_quantity < item.quantity) {
        throw new BadRequestException(
          `Insufficient warehouse stock for product ${item.product_id} (available: ${warehouseInv.current_quantity}, required: ${item.quantity})`,
        );
      }

      await this.inventoryRepo.adjust(warehouseInv.id, -item.quantity, client);

      await this.auditLogsService.log(
        {
          shop_id: warehouseShopId,
          user_id: userId,
          type: 'INVENTORY',
          action: 'TRANSFER_OUT',
          entity_type: 'inventory',
          entity_id: warehouseInv.id,
          quantity: item.quantity,
          notes: `Order #${orderId} — transferred to shop ${toShopId}`,
        },
        client,
      );

      await this.inventoryRepo.upsertStockIn(toShopId, item.product_id, item.quantity, client);

      const shopInv = await this.inventoryRepo.findByShopAndProduct(toShopId, item.product_id, client);

      await this.auditLogsService.log(
        {
          shop_id: toShopId,
          user_id: userId,
          type: 'INVENTORY',
          action: 'TRANSFER_IN',
          entity_type: 'inventory',
          entity_id: shopInv?.id,
          quantity: item.quantity,
          notes: `Order #${orderId} — received from warehouse`,
        },
        client,
      );
    }
  }

  private assertReadAccess(user: RequestUser, order: Order): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (order.from_shop_id !== user.shopId && order.to_shop_id !== user.shopId) {
      throw new ForbiddenException('You do not have access to this order');
    }
  }
}
