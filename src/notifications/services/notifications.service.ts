import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService, I18nContext } from 'nestjs-i18n';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { NotificationQueryDto } from '../dto/notification-query.dto';
import { Notification } from '../entities/notification.entity';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly i18n: I18nService,
  ) {}

  async findAll(query: NotificationQueryDto, user: RequestUser): Promise<PaginatedResponse<Notification>> {
    const result = await this.notificationsRepo.findPaginatedForShop(user.shopId!, query);
    const lang = I18nContext.current()?.lang ?? 'en';
    const translated = result.data.map((n) => this.translate(n, lang));
    return paginate(translated, query.page, query.limit, result.total);
  }

  async markRead(id: number, user: RequestUser): Promise<{ success: boolean }> {
    const notification = await this.notificationsRepo.markRead(id, user.shopId!);
    if (!notification) throw new NotFoundException('notifications.NOT_FOUND');
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
      title: 'notifications.ORDER_CREATED_TITLE',
      message: 'notifications.ORDER_CREATED_MESSAGE',
      type: 'ORDER_CREATED',
      args: { orderId },
    });
  }

  async notifyStatusChanged(orderId: number, status: string, toShopId: number): Promise<void> {
    await this.notificationsRepo.insert({
      shop_id: toShopId,
      title: 'notifications.ORDER_STATUS_TITLE',
      message: 'notifications.ORDER_STATUS_MESSAGE',
      type: 'ORDER_STATUS',
      args: { orderId, status },
    });
  }

  async notifyLowStock(productName: string, shopId: number): Promise<void> {
    const alreadyNotified = await this.notificationsRepo.hasUnreadLowStock(shopId, productName);
    if (alreadyNotified) return;

    await this.notificationsRepo.insert({
      shop_id: shopId,
      title: 'notifications.LOW_STOCK_TITLE',
      message: 'notifications.LOW_STOCK_MESSAGE',
      type: 'LOW_STOCK',
      args: { productName },
    });
  }

  // Translates title and message if they hold an i18n key (namespace.KEY pattern).
  private translate(notification: Notification, lang: string): Notification {
    const args = notification.args ?? {};
    return {
      ...notification,
      title: this.resolveKey(notification.title, args, lang),
      message: notification.message ? this.resolveKey(notification.message, args, lang) : null,
    };
  }

  private resolveKey(value: string, args: Record<string, unknown>, lang: string): string {
    if (/^\w+\.[A-Z_]+$/.test(value)) {
      return this.i18n.translate(value, { lang, args });
    }
    return value;
  }
}
