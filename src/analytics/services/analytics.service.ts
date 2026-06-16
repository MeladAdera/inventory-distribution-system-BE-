import { Injectable } from '@nestjs/common';
import { AnalyticsRepository, TopProductRow, TrendRow } from '../repositories/analytics.repository';
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
}
