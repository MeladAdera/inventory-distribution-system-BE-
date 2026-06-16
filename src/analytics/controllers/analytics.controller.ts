import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from '../services/analytics.service';
import { TopProductsQueryDto, ConsumptionTrendQueryDto, TrendPeriod } from '../dto/analytics-query.dto';
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
}
