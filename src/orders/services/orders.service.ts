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
import { NotificationsService } from '../../notifications/services/notifications.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { OrderQueryDto } from '../dto/order-query.dto';
import { Order, OrderWithItems, OrderStatus } from '../entities/order.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

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
    private readonly notificationsService: NotificationsService,
    private readonly db: DatabaseService,
  ) {}

  async createOrder(dto: CreateOrderDto, user: RequestUser): Promise<Order> {
    const toShopId = user.shopId!;

    const warehouse = await this.ordersRepo.findWarehouseShop();
    if (!warehouse) throw new BadRequestException('Warehouse not found');

    const productIds = dto.items.map((i) => i.productId);
    const hasDuplicates = new Set(productIds).size !== productIds.length;
    if (hasDuplicates) throw new BadRequestException('Duplicate products in order');

    const existing = await this.inventoryRepo.findByShopAndProducts(warehouse.id, productIds);
    if (existing.length !== productIds.length) {
      const foundIds = new Set(existing.map((inv) => inv.product_id));
      const missingId = productIds.find((id) => !foundIds.has(id));
      throw new BadRequestException(
        `Product ${missingId} does not exist in warehouse inventory`,
      );
    }

    const totalItems = dto.items.reduce((sum, i) => sum + i.quantity, 0);

    const order = await this.db.transaction(async (client) => {
      const created = await this.ordersRepo.insert(warehouse.id, toShopId, totalItems, client);
      await this.ordersRepo.insertItems(created.id, dto.items, client);
      return created;
    });

    await this.notificationsService.notifyOrderCreated(order.id, warehouse.id);
    return order;
  }

  async findAll(query: OrderQueryDto, user: RequestUser): Promise<PaginatedResponse<OrderWithItems>> {
    const isAdmin = user.role === UserRole.WAREHOUSE_ADMIN;
    const shopId = isAdmin ? undefined : user.shopId!;
    const toShopId = isAdmin ? query.shop_id : undefined;
    const result = await this.ordersRepo.findPaginated(query, shopId, toShopId);
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

    const updated = await this.db.transaction(async (client) => {
      const result = await this.ordersRepo.updateStatus(id, dto.status, client);

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

      return result;
    });

    await this.notificationsService.notifyStatusChanged(id, dto.status, order.to_shop_id);
    return updated;
  }

  private async transferInventory(
    orderId: number,
    warehouseShopId: number,
    toShopId: number,
    userId: number,
    client: import('pg').PoolClient,
  ): Promise<void> {
    const items = await this.ordersRepo.findItemsByOrderId(orderId, client);
    const productIds = items.map((i) => i.product_id);

    // 1 query — fetch all warehouse inventory records for this order's products
    const warehouseInventories = await this.inventoryRepo.findByShopAndProducts(
      warehouseShopId,
      productIds,
      client,
    );
    const warehouseMap = new Map(warehouseInventories.map((inv) => [inv.product_id, inv]));

    // Validate all stock in memory before touching anything
    for (const item of items) {
      const inv = warehouseMap.get(item.product_id);
      if (!inv) {
        throw new BadRequestException(
          `Warehouse inventory record missing for product ${item.product_id}`,
        );
      }
      if (inv.current_quantity < item.quantity) {
        throw new BadRequestException(
          `Insufficient warehouse stock for product ${item.product_id} (available: ${inv.current_quantity}, required: ${item.quantity})`,
        );
      }
    }

    // Deduct from warehouse + upsert into shop (N queries each — row-specific)
    for (const item of items) {
      const warehouseInv = warehouseMap.get(item.product_id)!;

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
    }

    // 1 query — fetch all resulting shop inventory records for TRANSFER_IN audit logs
    const shopInventories = await this.inventoryRepo.findByShopAndProducts(
      toShopId,
      productIds,
      client,
    );
    const shopMap = new Map(shopInventories.map((inv) => [inv.product_id, inv]));

    for (const item of items) {
      await this.auditLogsService.log(
        {
          shop_id: toShopId,
          user_id: userId,
          type: 'INVENTORY',
          action: 'TRANSFER_IN',
          entity_type: 'inventory',
          entity_id: shopMap.get(item.product_id)?.id,
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
