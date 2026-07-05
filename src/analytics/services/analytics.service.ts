import { Injectable, BadRequestException } from '@nestjs/common';
import { AnalyticsRepository, TopProductRow, TrendRow, ProductByShopRow, ProductByShopRawRow, ShopConsumptionRow, ProfitSummaryRow, ProfitTrendRow } from '../repositories/analytics.repository';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { TrendPeriod } from '../dto/analytics-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

@Injectable()
export class AnalyticsService {
  constructor(private readonly analyticsRepository: AnalyticsRepository) {}

  getTopProducts(limit: number, user: RequestUser): Promise<TopProductRow[]> {
    const shopId = user.role === UserRole.WAREHOUSE_ADMIN
      ? undefined
      : (user.shopId ?? undefined);
    return this.analyticsRepository.getTopProducts(limit, shopId);
  }

  getConsumptionTrend(period: TrendPeriod, user: RequestUser): Promise<TrendRow[]> {
    const shopId = user.role === UserRole.WAREHOUSE_ADMIN
      ? undefined
      : (user.shopId ?? undefined);
    return this.analyticsRepository.getConsumptionTrend(period, shopId);
  }

  async getShopConsumption(
    period: TrendPeriod,
    shopId: number | undefined,
    user: RequestUser,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<ShopConsumptionRow>> {
    const offset = (page - 1) * limit;

    let resolvedShopId: number;

    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      if (shopId === undefined) {
        throw new BadRequestException('shopId is required for WAREHOUSE_ADMIN');
      }
      resolvedShopId = shopId;
    } else {
      if (user.shopId === null) {
        throw new BadRequestException('User has no associated shop');
      }
      resolvedShopId = user.shopId;
    }

    const { data, total } = await this.analyticsRepository.getShopConsumption(
      period,
      resolvedShopId,
      limit,
      offset,
    );

    return paginate(data, page, limit, total);
  }

  // Admin: warehouse profit (orders), or a shop's profit when shopId is given.
  // Shop owner: always their own shop's profit (receipts).
  getProfitSummary(period: TrendPeriod, shopId: number | undefined, user: RequestUser): Promise<ProfitSummaryRow> {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      return shopId !== undefined
        ? this.analyticsRepository.getShopProfitSummary(period, shopId)
        : this.analyticsRepository.getWarehouseProfitSummary(period);
    }
    if (user.shopId === null) {
      throw new BadRequestException('User has no associated shop');
    }
    return this.analyticsRepository.getShopProfitSummary(period, user.shopId);
  }

  getProfitTrend(period: TrendPeriod, shopId: number | undefined, user: RequestUser): Promise<ProfitTrendRow[]> {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      return shopId !== undefined
        ? this.analyticsRepository.getShopProfitTrend(period, shopId)
        : this.analyticsRepository.getWarehouseProfitTrend(period);
    }
    if (user.shopId === null) {
      throw new BadRequestException('User has no associated shop');
    }
    return this.analyticsRepository.getShopProfitTrend(period, user.shopId);
  }

  async getProductsByShop(
    period: TrendPeriod,
    limit: number,
    shopId?: number,
  ): Promise<ProductByShopRow[]> {
    const rows: ProductByShopRawRow[] = await this.analyticsRepository.getProductsByShop(period, limit, shopId);

    const map = new Map<number, ProductByShopRow>();

    for (const row of rows) {
      if (!map.has(row.product_id)) {
        map.set(row.product_id, {
          product_id: row.product_id,
          product_name: row.product_name,
          total_quantity: row.total_quantity,
          shops: [],
        });
      }
      map.get(row.product_id)!.shops.push({
        shop_id: row.shop_id,
        shop_name: row.shop_name,
        quantity: row.shop_quantity,
      });
    }

    return Array.from(map.values());
  }
}
