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
import { AddInventoryProductDto } from '../dto/add-inventory-product.dto';
import { AdjustInventoryDto } from '../dto/adjust-inventory.dto';
import { UpdateSalePriceDto } from '../dto/update-sale-price.dto';
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

  @Post()
  @Roles(UserRole.SHOP_OWNER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: "Add a catalog product to this shop's inventory at quantity 0 (optional opening balance). Idempotent — re-adding returns the existing record." })
  addProduct(
    @Body() dto: AddInventoryProductDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventoryService.addProduct(dto, user);
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

  @Patch(':id/price')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Set the per-shop selling price for an inventory item (shop owner: own shop only)' })
  setSalePrice(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSalePriceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.inventoryService.setSalePrice(id, dto, user);
  }
}
