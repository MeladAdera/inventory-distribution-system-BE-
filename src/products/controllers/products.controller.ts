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
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { imageStorage, imageFileFilter } from '../../common/utils/upload.config';
import { ProductsService } from '../services/products.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductQueryDto } from '../dto/product-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'List products with pagination — admin sees all, others see own + warehouse. Filters: ?source=, ?category_id=, ?shop_id= (admin)',
  })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: ProductQueryDto,
  ) {
    return this.productsService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID' })
  findById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productsService.findById(id, user);
  }

  @Post()
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({
    summary: 'Create a product — admin defaults to warehouse; pass ?shop_id= to create for another shop',
  })
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: RequestUser,
    @Query('shop_id', new ParseIntPipe({ optional: true })) shopId?: number,
  ) {
    if (user.role === UserRole.WAREHOUSE_ADMIN && shopId) {
      return this.productsService.createForShop(dto, shopId);
    }
    return this.productsService.create(dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @ApiOperation({ summary: 'Update a product — admin any, shop owner own products only' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productsService.update(id, dto, user);
  }

  @Patch(':id/image')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @UseInterceptors(FileInterceptor('image', {
    storage: imageStorage('products'),
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace product image — multipart/form-data, field name: image, max 5 MB' })
  uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })] })) file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    const imageUrl = `/uploads/products/${file.filename}`;
    return this.productsService.uploadImage(id, imageUrl, user);
  }

  @Delete(':id/image')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove product image — sets image_url back to null' })
  deleteImage(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productsService.deleteImage(id, user);
  }

  @Delete(':id')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a product — sets is_active=false, preserves inventory and order history' })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productsService.remove(id, user);
  }
}
