import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShiftsService } from '../services/shifts.service';
import { UpdateOpeningHoursDto } from '../dto/update-opening-hours.dto';
import { CreateShiftTemplateDto, UpdateShiftTemplateDto } from '../dto/shift-template.dto';
import { AssignEmployeesDto } from '../dto/assign-employees.dto';
import { OpenShiftDto } from '../dto/open-shift.dto';
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

  @Get('templates')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      "The week's shift plan, ordered by weekday then position, each with its length in minutes. Employees read it to see when they work.",
  })
  getTemplates(@CurrentUser() user: RequestUser) {
    return this.shiftsService.getTemplates(user);
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Add a shift to a weekday. Max 4 per day; it must fit inside that day\'s opening hours and must not overlap another shift. Position within the day is assigned by the server.',
  })
  createTemplate(@Body() dto: CreateShiftTemplateDto, @CurrentUser() user: RequestUser) {
    return this.shiftsService.createTemplate(dto, user);
  }

  @Patch('templates/:id')
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Rename a shift or move its boundaries. Re-checks opening hours and overlap. To move a shift to another weekday, delete it and create it there.',
  })
  updateTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShiftTemplateDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.shiftsService.updateTemplate(id, dto, user);
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Remove a shift from the plan. Retired rather than erased, so past sessions keep naming the shift they were worked under, and its position is freed for reuse.',
  })
  deleteTemplate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.shiftsService.deleteTemplate(id, user);
  }

  @Put('templates/:id/assignees')
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      "Replace a slot's rota. Send the complete list of user ids; an empty list clears it. Assignees must be active employees of this shop.",
  })
  assignEmployees(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignEmployeesDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.shiftsService.assignEmployees(id, dto, user);
  }

  @Get('open')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      "The shop's open shift with the names resolved, or null. One shop has one open shift, so this answers both \"is anyone working\" and \"am I working\" — compare user_id with your own.",
  })
  getOpenSession(@CurrentUser() user: RequestUser) {
    return this.shiftsService.getOpenSession(user);
  }

  @Post('open')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      'Start a shift with the cash already in the drawer. The server resolves which slot is running from the shop clock, so no shift id is sent. Opening outside your own slot is allowed and flagged is_off_schedule. Conflicts while another shift is open.',
  })
  openShift(@Body() dto: OpenShiftDto, @CurrentUser() user: RequestUser) {
    return this.shiftsService.openShift(dto, user);
  }
}
