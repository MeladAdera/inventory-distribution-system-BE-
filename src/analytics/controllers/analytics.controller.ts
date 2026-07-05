import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from '../services/analytics.service';
import { TopProductsQueryDto, ConsumptionTrendQueryDto, ProductsByShopQueryDto, ShopConsumptionQueryDto, ProfitQueryDto, TrendPeriod } from '../dto/analytics-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('top-products')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary: 'Top consumed products by total quantity in COMPLETED orders. Admin: all shops. Others: own shop only.',
  })
  getTopProducts(
    @Query() query: TopProductsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.analyticsService.getTopProducts(query.limit ?? 5, user);
  }

  @Get('consumption-trend')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary: 'Total units consumed over time for COMPLETED orders. ?period=daily (14 days) | weekly (8 weeks) | monthly (6 months)',
  })
  getConsumptionTrend(
    @Query() query: ConsumptionTrendQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.analyticsService.getConsumptionTrend(query.period ?? TrendPeriod.DAILY, user);
  }

  @Get('shop-consumption')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary: 'Per-product consumption for a shop from receipts. Admin: requires ?shopId. Shop owner/employee: auto-scoped to own shop.',
  })
  getShopConsumption(
    @Query() query: ShopConsumptionQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.analyticsService.getShopConsumption(
      query.period ?? TrendPeriod.DAILY,
      query.shopId,
      user,
      query.page,
      query.limit,
    );
  }

  // EMPLOYEE deliberately excluded — profit/margin data is owner-level information
  @Get('profit-summary')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'Revenue, cost and profit for the period. Admin: warehouse profit from COMPLETED orders, or ?shopId= for a shop\'s sales profit. Shop owner: own shop\'s sales profit from receipts.',
  })
  getProfitSummary(
    @Query() query: ProfitQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.analyticsService.getProfitSummary(query.period ?? TrendPeriod.DAILY, query.shopId, user);
  }

  @Get('profit-trend')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'Revenue/cost/profit over time buckets. Same scoping as profit-summary. ?period=daily (14 days) | weekly (8 weeks) | monthly (6 months)',
  })
  getProfitTrend(
    @Query() query: ProfitQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.analyticsService.getProfitTrend(query.period ?? TrendPeriod.DAILY, query.shopId, user);
  }

  @Get('products-by-shop')
  @Roles(UserRole.WAREHOUSE_ADMIN)
  @ApiOperation({
    summary: 'Top products by consumption broken down per shop. WAREHOUSE_ADMIN only. ?period=daily|weekly|monthly &limit=10 &shopId=2',
  })
  getProductsByShop(@Query() query: ProductsByShopQueryDto) {
    return this.analyticsService.getProductsByShop(
      query.period ?? TrendPeriod.DAILY,
      query.limit ?? 10,
      query.shopId,
    );
  }
}
