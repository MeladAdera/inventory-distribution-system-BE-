import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShiftsService } from '../services/shifts.service';
import { UpdateOpeningHoursDto } from '../dto/update-opening-hours.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

/**
 * Scheduling is a shop-floor concern, so `WAREHOUSE_ADMIN` is absent from
 * every route here: the role carries no `shop_id`, and there is no warehouse
 * rota to read. The owner writes the schedule; employees only read it.
 */
@ApiTags('shifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get('opening-hours')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      "The shop's trading week — always 7 days, weekday 0 = Sunday, plus the shop timezone. Unset days come back closed.",
  })
  getOpeningHours(@CurrentUser() user: RequestUser) {
    return this.shiftsService.getOpeningHours(user);
  }

  @Put('opening-hours')
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Replace the whole trading week. Send all 7 days. closeTime earlier than openTime means the day runs past midnight; 24:00 means end of day.',
  })
  updateOpeningHours(@Body() dto: UpdateOpeningHoursDto, @CurrentUser() user: RequestUser) {
    return this.shiftsService.updateOpeningHours(dto, user);
  }
}
