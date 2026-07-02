import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateShopOwnerDto } from '../dto/create-shop-owner.dto';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  @Post('shop-owners')
  @Roles(UserRole.WAREHOUSE_ADMIN)
  @ApiOperation({ summary: 'Create a shop and its owner (WAREHOUSE_ADMIN only)' })
  createShopOwner(@Body() dto: CreateShopOwnerDto) {
    return this.usersService.createShopOwner(dto);
  }

  @Post('employees')
  @Roles(UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Create an employee for your shop (SHOP_OWNER only)' })
  createEmployee(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() owner: { id: number; shopId: number },
  ) {
    return this.usersService.createEmployee(dto, owner);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  @Get()
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'List users — WAREHOUSE_ADMIN sees all, SHOP_OWNER sees only their shop. Filters: ?role= ?shop_id= ?search= ?page= ?limit=',
  })
  findAll(
    @Query() query: UserQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.findAll(query, user);
  }

  @Get(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'Get a single user — WAREHOUSE_ADMIN can fetch any, SHOP_OWNER only users in their shop',
  })
  findById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.findById(id, user);
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'Update a user\'s name or email — WAREHOUSE_ADMIN any user, SHOP_OWNER own employees only',
  })
  updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.updateUser(id, dto, user);
  }

  // ── Deactivate ─────────────────────────────────────────────────────────────

  @Delete(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'Deactivate a user (soft delete) — WAREHOUSE_ADMIN any user, SHOP_OWNER own employees only',
  })
  deactivateUser(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.deactivateUser(id, user);
  }

  // ── Activate ───────────────────────────────────────────────────────────────

  @Patch(':id/activate')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'Reactivate a previously deactivated user — WAREHOUSE_ADMIN any user, SHOP_OWNER own employees only',
  })
  activateUser(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.activateUser(id, user);
  }
}
