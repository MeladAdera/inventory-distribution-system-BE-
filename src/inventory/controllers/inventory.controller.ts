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
import { InventoryService } from '../services/inventory.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { InventoryQueryDto } from '../dto/inventory-query.dto';
import { StockInDto } from '../dto/stock-in.dto';
import { AdjustInventoryDto } from '../dto/adjust-inventory.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List inventory — admin sees all shops, others see own shop. Filters: ?lowStock=true, ?productId=, ?shop_id= (WAREHOUSE_ADMIN only)' })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventoryService.findAll(user, query);
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'List inventory items where current quantity is at or below the low-stock threshold' })
  getLowStock(@CurrentUser() user: RequestUser) {
    return this.inventoryService.getLowStock(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single inventory record by ID' })
  findById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventoryService.findById(id, user);
  }
  @Post('stock-in')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Receive stock — creates inventory record if it does not exist, then increases quantity' })
  stockIn(
    @Body() dto: StockInDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventoryService.stockIn(dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Adjust inventory quantity — positive to add, negative to remove. Cannot go below zero.' })
  adjust(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdjustInventoryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventoryService.adjust(id, dto, user);
  }
}
