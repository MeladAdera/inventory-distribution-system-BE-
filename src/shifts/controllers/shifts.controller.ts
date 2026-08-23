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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShiftsService } from '../services/shifts.service';
import { UpdateOpeningHoursDto } from '../dto/update-opening-hours.dto';
import { CreateShiftTemplateDto, UpdateShiftTemplateDto } from '../dto/shift-template.dto';
import { AssignEmployeesDto } from '../dto/assign-employees.dto';
import { OpenShiftDto } from '../dto/open-shift.dto';
import { CloseShiftDto } from '../dto/close-shift.dto';
import { ShiftReportQueryDto, ShiftSessionQueryDto } from '../dto/shift-query.dto';
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

  @Post(':id/close')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      "End a shift by counting the drawer. The server works out what should be there and freezes the difference — it is never recalculated on read. Anyone in the shop may close, so a drawer left open does not block the next employee; closed_by records who counted.",
  })
  closeShift(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.shiftsService.closeShift(id, dto, user);
  }

  @Get('report')
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Money grouped by employee and by shift over a date range. Sales are attributed by who rang them up; cash differences by whose shift it was.',
  })
  getReport(@Query() query: ShiftReportQueryDto, @CurrentUser() user: RequestUser) {
    return this.shiftsService.getReport(query, user);
  }

  @Get('sessions')
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Shift history, newest trading day first. Filters: from, to (business date), userId, status. Paginated.',
  })
  findSessions(@Query() query: ShiftSessionQueryDto, @CurrentUser() user: RequestUser) {
    return this.shiftsService.findSessions(query, user);
  }

  @Get('sessions/:id')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      'One shift with the receipts behind it. The owner sees any; an employee only shifts they worked — being asked about a shortage means being able to see the sales it came from.',
  })
  findSessionById(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.shiftsService.findSessionById(id, user);
  }
}
