import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from '../services/analytics.service';
import { DebtsService } from '../../debts/services/debts.service';
import { DebtQueryDto } from '../../debts/dto/debt-query.dto';
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
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly debtsService: DebtsService,
  ) {}

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

  // Receivables are delegated to DebtsService rather than reimplemented here:
  // it already owns the role-based visibility rules, and a second copy of that
  // scoping is how a data leak eventually gets introduced.
  //
  // EMPLOYEE is included, unlike the profit endpoints above. Profit is
  // owner-level information; who still owes money is the job of whoever
  // collects it. Their view is scoped to customer debts either way.
  @Get('receivables')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      'Money owed and collected: total_billed, total_collected, total_remaining, open_count, refund_due. Same filters and scoping as GET /debts.',
  })
  getReceivables(
    @Query() query: DebtQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.debtsService.getSummary(query, user, 'SHOP');
  }

  @Get('receivables/aging')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      'Outstanding balances grouped by age (0-30 / 31-60 / 60+ days). Drill into a band with GET /debts?agingBucket=.',
  })
  getReceivablesAging(
    @Query() query: DebtQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.debtsService.getAging(query, user, 'SHOP');
  }

  // The payable mirror of receivables above — same delegation to DebtsService,
  // same generic getSummary/getAging, just creditorType 'SUPPLIER' instead of
  // 'SHOP'. EMPLOYEE is excluded here, unlike receivables: owing suppliers
  // money is owner-level, same reasoning as the /suppliers routes themselves.
  //
  // Scoping differs from receivables too, and not by accident: both roles see
  // their own shop only. The admin's warehouse-wide view on the receivables
  // routes comes from the warehouse being the creditor there — it is not a
  // party to what another shop owes its suppliers. See visibilityFor.
  @Get('payables')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Money owed to your own shop\'s suppliers: total_billed, total_collected, total_remaining, open_count, refund_due. Same filters as GET /debts. Own shop only, admin included.',
  })
  getPayables(
    @Query() query: DebtQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.debtsService.getSummary(query, user, 'SUPPLIER');
  }

  @Get('payables/aging')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Money owed to your own shop\'s suppliers grouped by age (0-30 / 31-60 / 60+ days). Own shop only, admin included.',
  })
  getPayablesAging(
    @Query() query: DebtQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.debtsService.getAging(query, user, 'SUPPLIER');
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
