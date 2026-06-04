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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CategoriesService } from '../services/categories.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
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

@ApiTags('categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List categories — admin: all shops (or filter by ?shopId=); others: own + warehouse' })
  @ApiQuery({ name: 'shopId', required: false, type: Number })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query('shopId', new ParseIntPipe({ optional: true })) shopId?: number,
  ) {
    return this.categoriesService.findAll(user, shopId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a category by ID' })
  findById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.categoriesService.findById(id, user);
  }

  @Post()
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Create a category — admin defaults to warehouse, pass ?shopId= to target another shop' })
  @ApiQuery({ name: 'shopId', required: false, type: Number })
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: RequestUser,
    @Query('shopId', new ParseIntPipe({ optional: true })) shopId?: number,
  ) {
    return this.categoriesService.create(dto, user, shopId);
  }

  @Patch(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Update a category name' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.categoriesService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category — blocked if products are assigned to it' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.categoriesService.remove(id, user);
  }
}
