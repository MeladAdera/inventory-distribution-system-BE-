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
import { RequestUser } from '../../common/interfaces/request-user.interface';

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

    const data = result.data.map((p) => this.hideCostFromNonOwners(user, p));
    return paginate(data, query.page, query.limit, result.total);
  }

  async findById(id: number, user: RequestUser): Promise<Product> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException('products.NOT_FOUND');

    this.assertAccess(user, product);
    return this.hideCostFromNonOwners(user, product);
  }

  async create(dto: CreateProductDto, user: RequestUser): Promise<Product> {
    const shopId = this.resolveShopId(user, undefined);

    const accessible = await this.productsRepo.categoryAccessible(dto.category_id, shopId);
    if (!accessible) {
      throw new BadRequestException('products.CATEGORY_NOT_FOUND');
    }

    const nameTaken = await this.productsRepo.findByNameAndShop(dto.name, shopId);
    if (nameTaken) throw new ConflictException('products.NAME_TAKEN');

    if (dto.barcode) {
      const duplicate = await this.productsRepo.findByBarcodeAndShop(dto.barcode, shopId);
      if (duplicate) throw new ConflictException('products.BARCODE_TAKEN');
    }

    return this.productsRepo.insert(dto.name, dto.description, dto.barcode, dto.price, dto.cost_price ?? 0, dto.category_id, shopId, dto.is_orderable);
  }

  async createForShop(dto: CreateProductDto, shopId: number): Promise<Product> {
    // Admin creating for a specific shop — same logic, different shopId.
    // Validate the shop first: otherwise the INSERT ... SELECT FROM shops finds
    // no row and silently returns undefined instead of a clear error.
    const shopExists = await this.productsRepo.shopExists(shopId);
    if (!shopExists) throw new NotFoundException('products.SHOP_NOT_FOUND');

    const accessible = await this.productsRepo.categoryAccessible(dto.category_id, shopId);
    if (!accessible) {
      throw new BadRequestException('products.CATEGORY_NOT_FOUND');
    }

    const nameTaken = await this.productsRepo.findByNameAndShop(dto.name, shopId);
    if (nameTaken) throw new ConflictException('products.NAME_TAKEN');

    if (dto.barcode) {
      const duplicate = await this.productsRepo.findByBarcodeAndShop(dto.barcode, shopId);
      if (duplicate) throw new ConflictException('products.BARCODE_TAKEN');
    }

    return this.productsRepo.insert(dto.name, dto.description, dto.barcode, dto.price, dto.cost_price ?? 0, dto.category_id, shopId, dto.is_orderable);
  }

  async update(id: number, dto: UpdateProductDto, user: RequestUser): Promise<Product> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException('products.NOT_FOUND');

    this.assertOwnership(user, product);

    if (dto.name && dto.name !== product.name) {
      const nameTaken = await this.productsRepo.findByNameAndShop(dto.name, product.shop_id, id);
      if (nameTaken) throw new ConflictException('products.NAME_TAKEN');
    }

    if (dto.barcode && dto.barcode !== product.barcode) {
      const duplicate = await this.productsRepo.findByBarcodeAndShop(dto.barcode, product.shop_id, id);
      if (duplicate) throw new ConflictException('products.BARCODE_TAKEN');
    }

    if (dto.category_id && dto.category_id !== product.category_id) {
      const accessible = await this.productsRepo.categoryAccessible(dto.category_id, product.shop_id);
      if (!accessible) {
        throw new BadRequestException('products.CATEGORY_NOT_FOUND');
      }
    }

    return this.productsRepo.update(id, dto);
  }

  async uploadImage(id: number, imageUrl: string, user: RequestUser): Promise<{ image_url: string }> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException('products.NOT_FOUND');

    this.assertOwnership(user, product);
    await this.productsRepo.updateImage(id, imageUrl);
    return { image_url: imageUrl };
  }

  async deleteImage(id: number, user: RequestUser): Promise<void> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException('products.NOT_FOUND');

    this.assertOwnership(user, product);
    await this.productsRepo.deleteImage(id);
  }

  async remove(id: number, user: RequestUser): Promise<void> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException('products.NOT_FOUND');

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
    throw new ForbiddenException('products.ACCESS_DENIED');
  }

  // cost_price reveals the owner's margin — only the admin and the owning shop may see it
  private hideCostFromNonOwners(user: RequestUser, product: Product): Product {
    if (user.role === UserRole.WAREHOUSE_ADMIN || product.shop_id === user.shopId) {
      return product;
    }
    return { ...product, cost_price: null };
  }

  // Write access: admin can edit any; shop owner can only edit their own shop's products
  private assertOwnership(user: RequestUser, product: Product): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (product.shop_id !== user.shopId) {
      throw new ForbiddenException('products.MODIFY_OWN_ONLY');
    }
  }
}
