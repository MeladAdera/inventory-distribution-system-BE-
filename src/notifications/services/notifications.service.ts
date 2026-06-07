import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { NotificationQueryDto } from '../dto/notification-query.dto';
import { Notification } from '../entities/notification.entity';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class NotificationsService {
  constructor(private readonly notificationsRepo: NotificationsRepository) {}

  async findAll(query: NotificationQueryDto, user: RequestUser): Promise<PaginatedResponse<Notification>> {
    const result = await this.notificationsRepo.findPaginatedForShop(user.shopId!, query);
    return paginate(result.data, query.page, query.limit, result.total);
  }

  async markRead(id: number, user: RequestUser): Promise<{ success: boolean }> {
    const notification = await this.notificationsRepo.markRead(id, user.shopId!);
    if (!notification) throw new NotFoundException('Notification not found');
    return { success: true };
  }

  async markAllRead(user: RequestUser): Promise<{ success: boolean }> {
    await this.notificationsRepo.markAllRead(user.shopId!);
    return { success: true };
  }

  // --- Trigger methods called by other modules ---

  async notifyOrderCreated(orderId: number, warehouseShopId: number): Promise<void> {
    await this.notificationsRepo.insert({
      shop_id: warehouseShopId,
      title: `New Order #${orderId}`,
      message: `Order #${orderId} has been submitted and is waiting for review.`,
      type: 'ORDER_CREATED',
    });
  }

  async notifyStatusChanged(orderId: number, status: string, toShopId: number): Promise<void> {
    await this.notificationsRepo.insert({
      shop_id: toShopId,
      title: `Order #${orderId} Updated`,
      message: `Order #${orderId} is now ${status}.`,
      type: 'ORDER_STATUS',
    });
  }

  async notifyLowStock(productName: string, shopId: number): Promise<void> {
    const title = `Low Stock: ${productName}`;
    const alreadyNotified = await this.notificationsRepo.hasUnreadLowStock(shopId, title);
    if (alreadyNotified) return;

    await this.notificationsRepo.insert({
      shop_id: shopId,
      title,
      message: `Product "${productName}" is below the minimum stock level.`,
      type: 'LOW_STOCK',
    });
  }
}
