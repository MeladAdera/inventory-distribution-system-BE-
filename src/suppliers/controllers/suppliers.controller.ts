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
import { SuppliersService } from '../services/suppliers.service';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { SupplierQueryDto } from '../dto/supplier-query.dto';
import { CreateSupplierDebtDto } from '../dto/create-supplier-debt.dto';
import { DebtQueryDto } from '../../debts/dto/debt-query.dto';
import { CreateSupplierPaymentDto } from '../../debts/dto/create-supplier-payment.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';

/**
 * Shop-scoped throughout, for both roles. EMPLOYEE is absent from every
 * route on purpose: who a shop buys from, and owing them money, is an
 * owner-level decision — same reasoning as the profit endpoints.
 */
@ApiTags('suppliers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Register a supplier. Phone must be unique within the shop.' })
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: RequestUser) {
    return this.suppliersService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'List suppliers with the outstanding balance owed to each. Filters: ?search=&hasDebt=&includeInactive=',
  })
  findAll(@Query() query: SupplierQueryDto, @CurrentUser() user: RequestUser) {
    return this.suppliersService.findAll(query, user);
  }

  @Get(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Get one supplier' })
  findById(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.suppliersService.findById(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Update a supplier' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.suppliersService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'Deactivate a supplier (soft delete). Blocked while money is owed either direction.',
  })
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.suppliersService.deactivate(id, user);
  }

  @Post(':id/debts')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Record a bill from this supplier. paidAmount defaults to 0 (fully on credit) and must not exceed totalAmount. ' +
      'Any items[] are stocked into this shop\'s inventory at their unitCost, in the same transaction, and must sum to totalAmount.',
  })
  createDebt(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSupplierDebtDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.suppliersService.createDebt(id, dto, user);
  }

  @Get(':id/debts')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: "This supplier's bills, one per invoice" })
  findDebts(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DebtQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.suppliersService.findDebts(id, query, user);
  }

  @Get(':id/debts/:debtId/items')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'The goods on one bill, with the resulting inventory cost basis' })
  findDebtItems(
    @Param('id', ParseIntPipe) id: number,
    @Param('debtId', ParseIntPipe) debtId: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.suppliersService.findDebtItems(id, debtId, user);
  }

  @Get(':id/summary')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Totals for this supplier — billed, collected, still owed' })
  getSummary(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.suppliersService.getSummary(id, user);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Pay this supplier. Without debtId, settles the oldest bills first and may span several.',
  })
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSupplierPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.suppliersService.addPayment(id, dto, user);
  }
}
