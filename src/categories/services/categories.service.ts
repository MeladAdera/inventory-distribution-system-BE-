import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException, // used in remove() to block deletion when products exist
} from '@nestjs/common';
import { CategoriesRepository } from '../repositories/categories.repository';
import { Category } from '../entities/category.entity';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoriesRepo: CategoriesRepository) {}

  // WAREHOUSE_ADMIN, no filter → all categories across all shops
  // WAREHOUSE_ADMIN, ?shopId=X  → only that shop's categories
  // SHOP_OWNER / EMPLOYEE       → own categories + warehouse categories
  async findAll(user: RequestUser, shopId?: number): Promise<Category[]> {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      return shopId
        ? this.categoriesRepo.findAllByShop(shopId)
        : this.categoriesRepo.findAll();
    }
    return this.categoriesRepo.findAllForShop(user.shopId!);
  }

  async findById(id: number, user: RequestUser): Promise<Category> {
    const category = await this.categoriesRepo.findById(id);
    if (!category) throw new NotFoundException('categories.NOT_FOUND');

    this.assertShopAccess(user, category.shop_id);
    return category;
  }

  async create(dto: CreateCategoryDto, user: RequestUser, shopId?: number): Promise<Category> {
    const targetShopId = this.resolveShopId(user, shopId);

    const duplicate = await this.categoriesRepo.findByNameAndShop(dto.name, targetShopId);
    if (duplicate) throw new ConflictException('categories.NAME_TAKEN');

    return this.categoriesRepo.insert(dto.name, targetShopId, dto.icon);
  }

  async update(id: number, dto: UpdateCategoryDto, user: RequestUser): Promise<Category> {
    const category = await this.categoriesRepo.findById(id);
    if (!category) throw new NotFoundException('categories.NOT_FOUND');

    this.assertShopAccess(user, category.shop_id);

    // Nothing to change — avoid a pointless UPDATE when neither field was sent.
    if (dto.name === undefined && dto.icon === undefined) {
      return category;
    }

    // Only enforce name uniqueness when the name is actually changing.
    if (dto.name !== undefined) {
      const duplicate = await this.categoriesRepo.findByNameAndShop(dto.name, category.shop_id, id);
      if (duplicate) throw new ConflictException('categories.NAME_TAKEN');
    }

    return this.categoriesRepo.update(id, dto);
  }

  async uploadImage(id: number, imageUrl: string, user: RequestUser): Promise<{ image_url: string }> {
    const category = await this.categoriesRepo.findById(id);
    if (!category) throw new NotFoundException('categories.NOT_FOUND');

    this.assertShopAccess(user, category.shop_id);
    await this.categoriesRepo.updateImage(id, imageUrl);
    return { image_url: imageUrl };
  }

  async deleteImage(id: number, user: RequestUser): Promise<void> {
    const category = await this.categoriesRepo.findById(id);
    if (!category) throw new NotFoundException('categories.NOT_FOUND');

    this.assertShopAccess(user, category.shop_id);
    await this.categoriesRepo.deleteImage(id);
  }

  async remove(id: number, user: RequestUser): Promise<void> {
    const category = await this.categoriesRepo.findById(id);
    if (!category) throw new NotFoundException('categories.NOT_FOUND');

    this.assertShopAccess(user, category.shop_id);

    const inUse = await this.categoriesRepo.hasProducts(id);
    if (inUse) {
      throw new BadRequestException('categories.HAS_PRODUCTS');
    }

    await this.categoriesRepo.deleteById(id);
  }

  // Resolves which shop to operate on.
  // Admin defaults to their own shop (the warehouse). Can override with ?shopId=X to manage any shop.
  // Non-admins always use their own shop.
  private resolveShopId(user: RequestUser, shopId?: number): number {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      return shopId ?? user.shopId!;
    }
    return user.shopId!;
  }

  // Non-admins can only touch categories that belong to their shop.
  private assertShopAccess(user: RequestUser, categoryShopId: number): void {
    if (user.role !== UserRole.WAREHOUSE_ADMIN && categoryShopId !== user.shopId) {
      throw new ForbiddenException('categories.MANAGE_OWN_ONLY');
    }
  }
}
