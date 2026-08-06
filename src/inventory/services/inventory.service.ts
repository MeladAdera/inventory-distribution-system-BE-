import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { InventoryRepository } from '../repositories/inventory.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { InventoryQueryDto } from '../dto/inventory-query.dto';
import { StockInDto } from '../dto/stock-in.dto';
import { AddInventoryProductDto } from '../dto/add-inventory-product.dto';
import { AdjustInventoryDto } from '../dto/adjust-inventory.dto';
import { UpdateSalePriceDto } from '../dto/update-sale-price.dto';
import { InventoryWithProduct } from '../entities/inventory.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly inventoryRepo: InventoryRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationsService: NotificationsService,
    private readonly db: DatabaseService,
  ) {}

  async findAll(user: RequestUser, query: InventoryQueryDto): Promise<PaginatedResponse<InventoryWithProduct>> {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      const result = await this.inventoryRepo.findAllForAdmin(query);
      return paginate(result.data, query.page, query.limit, result.total);
    }

    const result = await this.inventoryRepo.findPaginated(user.shopId!, query);
    return paginate(result.data, query.page, query.limit, result.total);
  }

  async findById(id: number, user: RequestUser): Promise<InventoryWithProduct> {
    const item = await this.inventoryRepo.findById(id);
    if (!item) throw new NotFoundException('inventory.NOT_FOUND');

    this.assertReadAccess(user, item.shop_id);
    return item;
  }

  async stockIn(dto: StockInDto, user: RequestUser): Promise<InventoryWithProduct> {
    const shopId = user.shopId!;

    // Validate the product exists and is in this shop's scope before touching
    // inventory: either the shop's own product or a shared warehouse product.
    // Avoids a raw FK error on a bad id, and blocks stocking another shop's
    // private (LOCAL) product into your own inventory.
    const product = await this.inventoryRepo.findProductForStockIn(dto.productId);
    if (!product) {
      throw new NotFoundException({ key: 'inventory.PRODUCT_NOT_FOUND', args: { productId: dto.productId } });
    }
    if (product.shop_id !== shopId && product.source !== 'WAREHOUSE') {
      throw new ForbiddenException('inventory.PRODUCT_NOT_IN_SCOPE');
    }

    // Tri-state → number | null for the blend. Nullish coalescing keeps an
    // explicit 0 (free stock) as 0, and turns an omitted unitCost into null so
    // the repo inherits the current avg (or seeds a new row from product cost).
    const addCost = dto.unitCost ?? null;

    const result = await this.db.transaction(async (client) => {
      const updated = await this.inventoryRepo.upsertStockIn(shopId, dto.productId, dto.quantity, addCost, client);

      await this.auditLogsService.log(
        {
          shop_id: shopId,
          user_id: user.id,
          type: 'INVENTORY',
          action: 'STOCK_IN',
          entity_type: 'inventory',
          entity_id: updated.id,
          quantity: dto.quantity,
          // Log the batch's total cost only when a unit cost was actually stated
          // (including an explicit 0); an omitted cost was inherited, not stated.
          amount: dto.unitCost !== undefined ? dto.unitCost * dto.quantity : undefined,
          notes: dto.notes,
        },
        client,
      );

      return this.inventoryRepo.findById(updated.id, client).then((r) => r!);
    });

    if (result.is_low_stock) {
      this.notificationsService.notifyLowStock(result.product_name, shopId)
        .catch((err: unknown) => this.logger.error('notifyLowStock failed', err));
    }

    return result;
  }

  // "Add from catalog" onboarding action: register a product onto this shop's
  // inventory without moving stock. Deliberately NOT a stock-in — no cost blend,
  // no low-stock notification (a fresh row at qty 0 is out-of-stock by design,
  // and restocking flows through orders). Idempotent: re-adding an already
  // tracked product returns the existing row untouched.
  async addProduct(dto: AddInventoryProductDto, user: RequestUser): Promise<InventoryWithProduct> {
    const shopId = user.shopId!;

    // Same scope guard as stockIn: only the shop's own product or a shared
    // warehouse product may be tracked — never another shop's private product.
    const product = await this.inventoryRepo.findProductForStockIn(dto.productId);
    if (!product) {
      throw new NotFoundException({ key: 'inventory.PRODUCT_NOT_FOUND', args: { productId: dto.productId } });
    }
    if (product.shop_id !== shopId && product.source !== 'WAREHOUSE') {
      throw new ForbiddenException('inventory.PRODUCT_NOT_IN_SCOPE');
    }

    const created = await this.db.transaction(async (client) => {
      const row = await this.inventoryRepo.registerProduct(shopId, dto.productId, dto.quantity ?? 0, client);

      // null → the row already existed (idempotent re-add): no state changed, so
      // no audit entry. Return the existing record as a success.
      if (!row) {
        const existing = await this.inventoryRepo.findByShopAndProduct(shopId, dto.productId, client);
        return this.inventoryRepo.findById(existing!.id, client).then((r) => r!);
      }

      await this.auditLogsService.log(
        {
          shop_id: shopId,
          user_id: user.id,
          type: 'INVENTORY',
          action: 'PRODUCT_ADDED',
          entity_type: 'inventory',
          entity_id: row.id,
          quantity: dto.quantity ?? 0,
        },
        client,
      );

      return this.inventoryRepo.findById(row.id, client).then((r) => r!);
    });

    return created;
  }

  // Cost-neutral by design: adjust only corrects the count, it never touches
  // avg_cost. A positive adjustment (a recount that finds extra units) values
  // those units at the current avg_cost — correct, since no purchase happened.
  // Edge case worth knowing: a positive adjust on an empty row (qty 0, avg 0)
  // mints units at cost 0. That's an accepted correction-path outcome, not a
  // bug — use stockIn (with a unitCost) when stock genuinely arrived at a cost.
  async adjust(id: number, dto: AdjustInventoryDto, user: RequestUser): Promise<InventoryWithProduct> {
    const item = await this.inventoryRepo.findById(id);
    if (!item) throw new NotFoundException('inventory.NOT_FOUND');

    this.assertWriteAccess(user, item.shop_id);

    const newQuantity = item.current_quantity + dto.adjustment;
    if (newQuantity < 0) {
      throw new BadRequestException({
        key: 'inventory.NEGATIVE_STOCK',
        args: { current: item.current_quantity, adjustment: dto.adjustment },
      });
    }

    const result = await this.db.transaction(async (client) => {
      const adjusted = await this.inventoryRepo.adjust(id, dto.adjustment, client);
      if (!adjusted) {
        throw new BadRequestException({
          key: 'inventory.NEGATIVE_STOCK',
          args: { current: item.current_quantity, adjustment: dto.adjustment },
        });
      }

      await this.auditLogsService.log(
        {
          shop_id: item.shop_id,
          user_id: user.id,
          type: 'INVENTORY',
          action: 'ADJUSTMENT',
          entity_type: 'inventory',
          entity_id: id,
          quantity: dto.adjustment,
          notes: dto.reason,
        },
        client,
      );

      return this.inventoryRepo.findById(id, client).then((r) => r!);
    });

    if (result.is_low_stock) {
      this.notificationsService.notifyLowStock(result.product_name, item.shop_id)
        .catch((err: unknown) => this.logger.error('notifyLowStock failed', err));
    }

    return result;
  }

  async setSalePrice(id: number, dto: UpdateSalePriceDto, user: RequestUser): Promise<InventoryWithProduct> {
    const item = await this.inventoryRepo.findById(id);
    if (!item) throw new NotFoundException('inventory.NOT_FOUND');

    this.assertWriteAccess(user, item.shop_id);

    return this.db.transaction(async (client) => {
      const updated = await this.inventoryRepo.updateSalePrice(id, dto.salePrice, client);
      if (!updated) throw new NotFoundException('inventory.NOT_FOUND');

      await this.auditLogsService.log(
        {
          shop_id: item.shop_id,
          user_id: user.id,
          type: 'INVENTORY',
          action: 'PRICE_CHANGE',
          entity_type: 'inventory',
          entity_id: id,
          amount: dto.salePrice,
          notes: {
            key: 'audit-logs.NOTE_PRICE_CHANGE',
            args: { from: item.sale_price, to: dto.salePrice },
          },
        },
        client,
      );

      return this.inventoryRepo.findById(id, client).then((r) => r!);
    });
  }

  async getLowStock(user: RequestUser): Promise<InventoryWithProduct[]> {
    if (user.role === UserRole.WAREHOUSE_ADMIN) {
      return this.inventoryRepo.findAllLowStockForAdmin();
    }
    return this.inventoryRepo.findLowStock(user.shopId!);
  }

  private assertReadAccess(user: RequestUser, shopId: number): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (user.shopId !== shopId) throw new ForbiddenException('inventory.ACCESS_DENIED');
  }

  private assertWriteAccess(user: RequestUser, shopId: number): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;
    if (user.shopId !== shopId) throw new ForbiddenException('inventory.MODIFY_OWN_ONLY');
  }
}
