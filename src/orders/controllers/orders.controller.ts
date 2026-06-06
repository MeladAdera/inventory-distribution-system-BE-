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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService, RequestUser } from '../services/orders.service';
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
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Create a new order request to the warehouse — SHOP_OWNER only' })
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

  @Patch(':id/status')
  @Roles(UserRole.WAREHOUSE_ADMIN)
  @ApiOperation({ summary: 'Advance order status — WAREHOUSE_ADMIN only. Transitions: PENDING→PROCESSING→SHIPPED→RECEIVED→COMPLETED' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.ordersService.updateStatus(id, dto, user);
  }
}
