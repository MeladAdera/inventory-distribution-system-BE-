import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { OrdersRepository } from '../repositories/orders.repository';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { DebtsService } from '../../debts/services/debts.service';
import { toMinor } from '../../common/utils/money.util';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { OrderQueryDto } from '../dto/order-query.dto';
import { Order, OrderWithItems, OrderStatus } from '../entities/order.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { ShopType } from '../../common/enums/shop-type.enum';
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
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersRepo: OrdersRepository,
    private readonly inventoryRepo: InventoryRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationsService: NotificationsService,
    private readonly debtsService: DebtsService,
    private readonly db: DatabaseService,
  ) {}

  async createOrder(dto: CreateOrderDto, user: RequestUser): Promise<Order> {
    let toShopId: number;
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      if (!dto.shopId) throw new BadRequestException('orders.SHOP_ID_REQUIRED');
      toShopId = dto.shopId;
    } else {
      toShopId = user.shopId!;
    }

    // Validate the destination is a real, active shop — not the warehouse, a
    // deactivated shop, or a non-existent id (which would otherwise surface as
    // a raw FK violation later in the transaction).
    const destShop = await this.ordersRepo.findShopById(toShopId);
    if (!destShop) {
      throw new BadRequestException({ key: 'orders.DEST_SHOP_NOT_FOUND', args: { shopId: toShopId } });
    }
    if (destShop.type !== ShopType.SHOP) {
      throw new BadRequestException('orders.DEST_NOT_A_SHOP');
    }
    if (!destShop.is_active) {
      throw new BadRequestException('orders.DEST_SHOP_INACTIVE');
    }

    const warehouse = await this.ordersRepo.findWarehouseShop();
    if (!warehouse) throw new BadRequestException('orders.WAREHOUSE_NOT_FOUND');

    const productIds = dto.items.map((i) => i.productId);
    const hasDuplicates = new Set(productIds).size !== productIds.length;
    if (hasDuplicates) throw new BadRequestException('orders.DUPLICATE_PRODUCTS');

    const totalItems = dto.items.reduce((sum, i) => sum + i.quantity, 0);

    const order = await this.db.transaction(async (client) => {
      // Lock inventory rows to prevent concurrent orders from over-committing the same stock.
      const warehouseInventories = await this.inventoryRepo.findByShopAndProductsForUpdate(
        warehouse.id,
        productIds,
        client,
      );

      if (warehouseInventories.length !== productIds.length) {
        const foundIds = new Set(warehouseInventories.map((inv) => inv.product_id));
        const missingId = productIds.find((id) => !foundIds.has(id));
        throw new BadRequestException({ key: 'orders.PRODUCT_NOT_IN_WAREHOUSE', args: { productId: missingId } });
      }

      const warehouseMap = new Map(warehouseInventories.map((inv) => [inv.product_id, inv]));

      for (const item of dto.items) {
        const inv = warehouseMap.get(item.productId)!;
        if (!inv.is_orderable) {
          throw new BadRequestException({ key: 'orders.PRODUCT_NOT_ORDERABLE', args: { productId: item.productId } });
        }
        if (inv.current_quantity < item.quantity) {
          if (inv.current_quantity === 0) {
            throw new BadRequestException({ key: 'orders.OUT_OF_STOCK', args: { product: inv.product_name } });
          }
          throw new BadRequestException({
            key: 'orders.INSUFFICIENT_STOCK',
            args: { product: inv.product_name, available: inv.current_quantity, required: item.quantity },
          });
        }
      }

      const created = await this.ordersRepo.insert(warehouse.id, toShopId, totalItems, client);
      // from_shop is the warehouse — snapshot cost from its avg_cost.
      await this.ordersRepo.insertItems(created.id, warehouse.id, dto.items, client);

      // Deduct from warehouse immediately so stock is unavailable for subsequent orders.
      for (const item of dto.items) {
        const warehouseInv = warehouseMap.get(item.productId)!;
        // The row is locked and quantity was validated above, so this should
        // always succeed. If the DB guard (current_quantity + delta >= 0) still
        // rejects it, fail loud rather than create an order without reserving.
        const adjusted = await this.inventoryRepo.adjust(warehouseInv.id, -item.quantity, client);
        if (!adjusted) {
          throw new BadRequestException({
            key: 'orders.INSUFFICIENT_STOCK',
            args: { product: warehouseInv.product_name, available: warehouseInv.current_quantity, required: item.quantity },
          });
        }
        await this.auditLogsService.log(
          {
            shop_id: warehouse.id,
            user_id: user.id,
            type: 'INVENTORY',
            action: 'TRANSFER_OUT',
            entity_type: 'inventory',
            entity_id: warehouseInv.id,
            quantity: item.quantity,
            notes: {
              key: 'audit-logs.NOTE_ORDER_RESERVED',
              args: { orderId: created.id, shopId: toShopId },
            },
          },
          client,
        );
      }

      return created;
    });

    this.notificationsService.notifyOrderCreated(order.id, warehouse.id)
      .catch((err: unknown) => this.logger.error('notifyOrderCreated failed', err));
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
    if (!order) throw new NotFoundException('orders.NOT_FOUND');
    this.assertReadAccess(user, order);
    return order;
  }

  async updateStatus(id: number, dto: UpdateOrderStatusDto, user: RequestUser): Promise<Order> {
    // Quick existence check before opening a transaction (avoids unnecessary lock).
    const preCheck = await this.ordersRepo.findById(id);
    if (!preCheck) throw new NotFoundException('orders.NOT_FOUND');

    const updated = await this.db.transaction(async (client) => {
      // Lock the row so concurrent requests cannot both pass validation and both
      // run transferInventory (which would double-deduct warehouse stock).
      const order = await this.ordersRepo.findByIdForUpdate(id, client);
      if (!order) throw new NotFoundException('orders.NOT_FOUND');

      if (dto.status === 'CANCELLED') {
        // Admins may cancel up to SHIPPED (stock is returned to the warehouse by
        // restoreWarehouseInventory); shop owners are further restricted to
        // PENDING in the branch below. The destination is never credited before
        // RECEIVED, so cancelling any of these states restores to the warehouse.
        const cancellable: OrderStatus[] = ['PENDING', 'PROCESSING', 'SHIPPED'];
        if (!cancellable.includes(order.status)) {
          throw new BadRequestException({ key: 'orders.CANNOT_CANCEL', args: { status: order.status } });
        }
        if (user.role === UserRole.SHOP_OWNER) {
          if (order.to_shop_id !== user.shopId) {
            throw new ForbiddenException('orders.CANCEL_OWN_ONLY');
          }
          if (order.status !== 'PENDING') {
            throw new ForbiddenException('orders.CANCEL_PENDING_ONLY');
          }
        }
      } else {
        if (user.role === UserRole.SHOP_OWNER) {
          if (order.to_shop_id !== user.shopId) {
            throw new ForbiddenException('orders.UPDATE_OWN_ONLY');
          }
          if (order.status !== 'SHIPPED' || dto.status !== 'RECEIVED') {
            throw new ForbiddenException('orders.SHIPPED_TO_RECEIVED_ONLY');
          }
        }
        const expected = NEXT_STATUS[order.status];
        if (expected !== dto.status) {
          throw new BadRequestException({
            key: 'orders.INVALID_STATUS_TRANSITION',
            args: { from: order.status, to: dto.status, expected: expected ?? 'none' },
          });
        }
      }

      // Only updates if the status still matches what we just read — guards against
      // a race that slips through between lock acquisition and the UPDATE.
      const result = await this.ordersRepo.updateStatus(id, dto.status, order.status, client);
      if (!result) {
        throw new ConflictException('orders.CONCURRENT_UPDATE');
      }

      await this.auditLogsService.log(
        {
          shop_id: null,
          user_id: user.id,
          type: 'ORDER',
          action: 'STATUS_CHANGED',
          entity_type: 'order',
          entity_id: id,
          notes: {
            key: 'audit-logs.NOTE_STATUS_CHANGED',
            args: {
              from: { key: `audit-logs.STATUS.${order.status}` },
              to: { key: `audit-logs.STATUS.${dto.status}` },
            },
          },
        },
        client,
      );

      if (dto.status === 'SHIPPED') {
        await this.raiseOrderDebt(order, user.id, client);
      }

      if (dto.status === 'RECEIVED') {
        await this.transferInventory(id, order.from_shop_id, order.to_shop_id, user.id, client);
      }

      if (dto.status === 'CANCELLED') {
        await this.restoreWarehouseInventory(id, order.from_shop_id, user.id, client);
        // An order is cancellable up to SHIPPED, which is exactly when the debt
        // exists — so this runs in the same transaction as the stock restore.
        // Payments already collected are kept and surface as refund_due.
        await this.debtsService.cancelDebt(
          { type: 'ORDER', id },
          user.id,
          { key: 'audit-logs.NOTE_ORDER_CANCELLED', args: { orderId: id } },
          client,
        );
      }

      return { result, order };
    });

    this.notificationsService.notifyStatusChanged(id, dto.status, updated.order.to_shop_id)
      .catch((err: unknown) => this.logger.error('notifyStatusChanged failed', err));
    return updated.result;
  }

  /**
   * Opens the shop's debt for an order at ship time — goods have left the
   * warehouse, so the shop genuinely owes for them. The total is snapshotted
   * from `order_items` here and never recalculated, so repricing a product
   * later cannot change what the shop already owes.
   *
   * Note this is earlier than revenue recognition, which counts COMPLETED
   * orders. Between SHIPPED and COMPLETED a receivable exists for an order not
   * yet booked as revenue — accepted, and normal accrual behaviour.
   */
  private async raiseOrderDebt(order: Order, userId: number, client: pg.PoolClient): Promise<void> {
    const total = await this.ordersRepo.sumTotalPrice(order.id, client);

    // A zero-priced order (samples, promotional stock) owes nothing — creating
    // a 0.00 debt would only add a row that is already settled.
    if (toMinor(total) <= 0n) return;

    await this.debtsService.createDebt(
      {
        kind: 'ORDER',
        creditorShopId: order.from_shop_id,
        debtorShopId: order.to_shop_id,
        orderId: order.id,
        totalAmount: total,
        createdBy: userId,
        note: `Order #${order.id}`,
      },
      client,
    );
  }

  private async transferInventory(
    orderId: number,
    _warehouseShopId: number,
    toShopId: number,
    userId: number,
    client: import('pg').PoolClient,
  ): Promise<void> {
    const items = await this.ordersRepo.findItemsByOrderId(orderId, client);

    // Warehouse stock was already deducted at order creation — only add to shop
    // now, blending the order's cost snapshot into the shop's moving average.
    for (const item of items) {
      const updated = await this.inventoryRepo.upsertStockIn(
        toShopId,
        item.product_id,
        item.quantity,
        Number(item.cost_price),
        client,
      );
      await this.auditLogsService.log(
        {
          shop_id: toShopId,
          user_id: userId,
          type: 'INVENTORY',
          action: 'TRANSFER_IN',
          entity_type: 'inventory',
          entity_id: updated.id,
          quantity: item.quantity,
          notes: { key: 'audit-logs.NOTE_ORDER_RECEIVED', args: { orderId } },
        },
        client,
      );
    }
  }

  private async restoreWarehouseInventory(
    orderId: number,
    warehouseShopId: number,
    userId: number,
    client: import('pg').PoolClient,
  ): Promise<void> {
    const items = await this.ordersRepo.findItemsByOrderId(orderId, client);

    // Return units at the cost they left with (order_items.cost_price) so total
    // warehouse inventory value is conserved even if the warehouse avg has moved
    // since the order shipped. upsertStockIn does the blend and locks the row.
    for (const item of items) {
      const updated = await this.inventoryRepo.upsertStockIn(
        warehouseShopId,
        item.product_id,
        item.quantity,
        Number(item.cost_price),
        client,
      );
      await this.auditLogsService.log(
        {
          shop_id: warehouseShopId,
          user_id: userId,
          type: 'INVENTORY',
          action: 'TRANSFER_IN',
          entity_type: 'inventory',
          entity_id: updated.id,
          quantity: item.quantity,
          notes: { key: 'audit-logs.NOTE_ORDER_RESTOCKED', args: { orderId } },
        },
        client,
      );
    }
  }

  private assertReadAccess(user: RequestUser, order: Order): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (order.from_shop_id !== user.shopId && order.to_shop_id !== user.shopId) {
      throw new ForbiddenException('orders.ACCESS_DENIED');
    }
  }
}
