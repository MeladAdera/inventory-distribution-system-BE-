import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomersService } from '../services/customers.service';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import { UpdateCustomerDto } from '../dto/update-customer.dto';
import { CustomerQueryDto } from '../dto/customer-query.dto';
import { DebtQueryDto } from '../../debts/dto/debt-query.dto';
import { CreateCustomerPaymentDto } from '../../debts/dto/create-customer-payment.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';

/**
 * Shop-scoped throughout. WAREHOUSE_ADMIN is absent from every route on
 * purpose: a shop's customers are its own business, and the admin already sees
 * what it needs through the debt totals.
 */
@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Register a credit customer. Phone must be unique within the shop.' })
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: RequestUser) {
    return this.customersService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary: 'List customers with their outstanding balance. Filters: ?search=&hasDebt=&includeInactive=',
  })
  findAll(@Query() query: CustomerQueryDto, @CurrentUser() user: RequestUser) {
    return this.customersService.findAll(query, user);
  }

  @Get(':id')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Get one customer' })
  findById(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.customersService.findById(id, user);
  }

  @Get(':id/debts')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: "The customer's debts, one per credit sale" })
  findDebts(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DebtQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.customersService.findDebts(id, query, user);
  }

  @Get(':id/summary')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Totals for one customer — billed, collected, still owed, refund due' })
  getSummary(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.customersService.getSummary(id, user);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      'Collect money from a customer. Without debtId the amount settles the oldest debts first and may span several.',
  })
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCustomerPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.customersService.addPayment(id, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Update a customer' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.customersService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Deactivate a customer (soft delete). Blocked while they owe money, or while the shop owes them a refund.',
  })
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.customersService.deactivate(id, user);
  }
}
