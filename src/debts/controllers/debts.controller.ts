import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DebtsService } from '../services/debts.service';
import { DebtQueryDto } from '../dto/debt-query.dto';
import { ReverseDebtPaymentDto } from '../dto/reverse-debt-payment.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@ApiTags('debts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('debts')
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Get()
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({
    summary:
      'List debts. Admin sees all; a shop sees debts it is a party to; an employee sees only customer debts. Filters: ?status=&debtorType=&shopId=&customerId=&fromDate=&toDate=',
  })
  findAll(@Query() query: DebtQueryDto, @CurrentUser() user: RequestUser) {
    return this.debtsService.findAll(query, user, 'SHOP');
  }

  // Declared before ':id' so the literal path is not swallowed by the param route.
  @Get('summary')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Totals across the debts the caller can see — accepts the same filters as GET /debts' })
  getSummary(@Query() query: DebtQueryDto, @CurrentUser() user: RequestUser) {
    return this.debtsService.getSummary(query, user, 'SHOP');
  }

  @Get(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Get one debt with its remaining balance' })
  findById(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.debtsService.findByIdForUser(id, user);
  }

  @Get(':id/payments')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Payment history for a debt, oldest first. Reversals appear as negative rows.' })
  findPayments(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.debtsService.findPaymentsForUser(id, user);
  }

  @Post(':id/payments/:paymentId/reverse')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Undo a collection by appending a negative row. Admin for order debts, shop owner for their own customer debts.',
  })
  reversePayment(
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() dto: ReverseDebtPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.debtsService.reversePaymentForUser(id, paymentId, dto, user);
  }

  @Post(':id/cancel')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary:
      'Cancel a supplier bill entered by mistake. Payables only — a receivable must be cancelled through its order/receipt.',
  })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReverseDebtPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.debtsService.cancelSupplierDebtForUser(id, dto, user);
  }
}
