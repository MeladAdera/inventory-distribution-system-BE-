import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ShopsService } from '../services/shops.service';
import { UpdateShopDto } from '../dto/update-shop.dto';
import { UpdateShopStatusDto } from '../dto/update-shop-status.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

interface RequestUser {
  id: number;
  role: UserRole;
  shopId: number | null;
}

@ApiTags('shops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get()
  @ApiOperation({ summary: 'List shops — all for WAREHOUSE_ADMIN, own shop for others' })
  findAll(@CurrentUser() user: RequestUser) {
    return this.shopsService.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a shop by ID — non-admins can only see their own shop' })
  findById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.shopsService.findById(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Update shop info — WAREHOUSE_ADMIN any shop, SHOP_OWNER own shop only' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShopDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.shopsService.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(UserRole.WAREHOUSE_ADMIN)
  @ApiOperation({ summary: 'Activate or deactivate a shop (soft delete) — WAREHOUSE_ADMIN only' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateShopStatusDto,
  ) {
    return this.shopsService.updateStatus(id, dto);
  }
}
