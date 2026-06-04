import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ProductsRepository } from '../repositories/products.repository';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductQueryDto } from '../dto/product-query.dto';
import { Product } from '../entities/product.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';

interface RequestUser {
  id: number;
  role: UserRole;
  shopId: number | null;
}

@Injectable()
export class ProductsService {
  constructor(private readonly productsRepo: ProductsRepository) {}

  async findAll(user: RequestUser, query: ProductQueryDto): Promise<PaginatedResponse<Product>> {
    let result: { data: Product[]; total: number };

    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      result = await this.productsRepo.findPaginatedAdmin(query);
    } else {
      result = await this.productsRepo.findPaginatedForShop(user.shopId!, query);
    }

    return paginate(result.data, query.page, query.limit, result.total);
  }

  async findById(id: number, user: RequestUser): Promise<Product> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException('Product not found');

    this.assertAccess(user, product);
    return product;
  }

  async create(dto: CreateProductDto, user: RequestUser): Promise<Product> {
    const shopId = this.resolveShopId(user, undefined);

    const accessible = await this.productsRepo.categoryAccessible(dto.category_id, shopId);
    if (!accessible) {
      throw new BadRequestException('Category not found or not accessible to this shop');
    }

    if (dto.barcode) {
      const duplicate = await this.productsRepo.findByBarcodeAndShop(dto.barcode, shopId);
      if (duplicate) throw new ConflictException('A product with this barcode already exists in this shop');
    }

    return this.productsRepo.insert(dto.name, dto.description, dto.barcode, dto.price, dto.category_id, shopId);
  }

  async createForShop(dto: CreateProductDto, shopId: number): Promise<Product> {
    // Admin creating for a specific shop — same logic, different shopId
    const accessible = await this.productsRepo.categoryAccessible(dto.category_id, shopId);
    if (!accessible) {
      throw new BadRequestException('Category not found or not accessible to this shop');
    }

    if (dto.barcode) {
      const duplicate = await this.productsRepo.findByBarcodeAndShop(dto.barcode, shopId);
      if (duplicate) throw new ConflictException('A product with this barcode already exists in this shop');
    }

    return this.productsRepo.insert(dto.name, dto.description, dto.barcode, dto.price, dto.category_id, shopId);
  }

  async update(id: number, dto: UpdateProductDto, user: RequestUser): Promise<Product> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException('Product not found');

    this.assertOwnership(user, product);

    if (dto.barcode && dto.barcode !== product.barcode) {
      const duplicate = await this.productsRepo.findByBarcodeAndShop(dto.barcode, product.shop_id, id);
      if (duplicate) throw new ConflictException('A product with this barcode already exists in this shop');
    }

    if (dto.category_id && dto.category_id !== product.category_id) {
      const accessible = await this.productsRepo.categoryAccessible(dto.category_id, product.shop_id);
      if (!accessible) {
        throw new BadRequestException('Category not found or not accessible to this shop');
      }
    }

    return this.productsRepo.update(id, dto);
  }

  async remove(id: number, user: RequestUser): Promise<void> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException('Product not found');

    this.assertOwnership(user, product);
    await this.productsRepo.softDelete(id);
  }

  // Admin defaults to their own shop (warehouse). Can pass shopId to target another shop.
  private resolveShopId(user: RequestUser, shopId?: number): number {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      return shopId ?? user.shopId!;
    }
    return user.shopId!;
  }

  // Read access: admin sees all; others see own shop + warehouse products
  private assertAccess(user: RequestUser, product: Product): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (product.shop_id === user.shopId || product.source === 'WAREHOUSE') return;
    throw new ForbiddenException('You do not have access to this product');
  }

  // Write access: admin can edit any; shop owner can only edit their own shop's products
  private assertOwnership(user: RequestUser, product: Product): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (product.shop_id !== user.shopId) {
      throw new ForbiddenException('You can only modify products belonging to your own shop');
    }
  }
}
