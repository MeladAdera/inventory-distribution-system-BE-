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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { imageStorage, imageFileFilter } from '../../common/utils/upload.config';
import { CategoriesService } from '../services/categories.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';

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

  @Patch(':id/image')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @UseInterceptors(FileInterceptor('image', {
    storage: imageStorage('categories'),
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace category image — multipart/form-data, field name: image, max 5 MB' })
  uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })] })) file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ) {
    const imageUrl = `/uploads/categories/${file.filename}`;
    return this.categoriesService.uploadImage(id, imageUrl, user);
  }

  @Delete(':id/image')
  @Roles(UserRole.WAREHOUSE_ADMIN, UserRole.SHOP_OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove category image — sets image_url back to null' })
  deleteImage(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.categoriesService.deleteImage(id, user);
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
