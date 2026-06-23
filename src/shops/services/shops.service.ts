import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ShopsRepository } from '../repositories/shops.repository';
import { Shop } from '../entities/shop.entity';
import { UpdateShopDto } from '../dto/update-shop.dto';
import { UpdateShopStatusDto } from '../dto/update-shop-status.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { ShopType } from '../../common/enums/shop-type.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class ShopsService {
  constructor(private readonly shopsRepo: ShopsRepository) {}

  // WAREHOUSE_ADMIN → all shops
  // SHOP_OWNER / EMPLOYEE → their own shop only
  async findAll(user: RequestUser): Promise<Shop | Shop[]> {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      return this.shopsRepo.findAll();
    }

    const shop = await this.shopsRepo.findById(user.shopId!);
    if (!shop) throw new NotFoundException('shops.NOT_FOUND');
    return shop;
  }

  // Any authenticated user can call this, but non-admins are locked to their own shop
  async findById(id: number, user: RequestUser): Promise<Shop> {
    const shop = await this.shopsRepo.findById(id);
    if (!shop) throw new NotFoundException('shops.NOT_FOUND');

    if (
      user.role !== UserRole.WAREHOUSE_ADMIN &&
      shop.id !== user.shopId
    ) {
      throw new ForbiddenException('shops.VIEW_OWN_ONLY');
    }

    return shop;
  }

  // WAREHOUSE_ADMIN → any shop
  // SHOP_OWNER → own shop only
  // EMPLOYEE → forbidden (enforced at controller level via @Roles)
  async update(id: number, dto: UpdateShopDto, user: RequestUser): Promise<Shop> {
    const shop = await this.shopsRepo.findById(id);
    if (!shop) throw new NotFoundException('shops.NOT_FOUND');

    if (
      user.role === UserRole.SHOP_OWNER &&
      shop.id !== user.shopId
    ) {
      throw new ForbiddenException('shops.UPDATE_OWN_ONLY');
    }

    return this.shopsRepo.update(id, dto);
  }

  // WAREHOUSE_ADMIN only (enforced at controller level via @Roles)
  // Cannot deactivate the warehouse itself
  async updateStatus(id: number, dto: UpdateShopStatusDto): Promise<Shop> {
    const shop = await this.shopsRepo.findById(id);
    if (!shop) throw new NotFoundException('shops.NOT_FOUND');

    if (shop.type === ShopType.WAREHOUSE && !dto.isActive) {
      throw new BadRequestException('shops.CANNOT_DEACTIVATE_WAREHOUSE');
    }

    return this.shopsRepo.updateStatus(id, dto.isActive);
  }
}
