import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from '../services/orders.service';
import { DebtsService } from '../../debts/services/debts.service';
import { CreateDebtPaymentDto } from '../../debts/dto/create-debt-payment.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { OrderQueryDto } from '../dto/order-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly debtsService: DebtsService,
  ) {}

  @Post()
  @Roles(UserRole.SHOP_OWNER, UserRole.WAREHOUSE_ADMIN)
  @ApiOperation({ summary: 'Create a new order. SHOP_OWNER uses their own shop as destination. WAREHOUSE_ADMIN must supply shopId in the body.' })
  createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ordersService.createOrder(dto, user);
  }

  @Get()
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'List orders — admin sees all, shop users see only their own. Filters: ?status=, ?page=, ?limit=' })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findAll(query, user);
  }

  @Get(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Get a single order with its items' })
  findById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ordersService.findById(id, user);
  }

  @Get(':id/debt')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: "The order's outstanding debt. 404 when the order was paid in full or has not shipped yet." })
  findDebt(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.debtsService.findByOrderForUser(id, user);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.WAREHOUSE_ADMIN)
  @ApiOperation({ summary: 'Record money received from the shop for this order. Admin only — the admin is who receives and verifies the cash.' })
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDebtPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.debtsService.addOrderPayment(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Update order status. WAREHOUSE_ADMIN: any sequential transition or cancel (PENDING/PROCESSING). SHOP_OWNER: SHIPPED→RECEIVED or cancel PENDING — own orders only.' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ordersService.updateStatus(id, dto, user);
  }
}
