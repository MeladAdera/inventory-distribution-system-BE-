import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { CustomersRepository } from '../repositories/customers.repository';
import { DebtsService } from '../../debts/services/debts.service';
import { Customer, CustomerListItem } from '../entities/customer.entity';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import { UpdateCustomerDto } from '../dto/update-customer.dto';
import { CustomerQueryDto } from '../dto/customer-query.dto';
import { DebtQueryDto } from '../../debts/dto/debt-query.dto';
import { CreateCustomerPaymentDto } from '../../debts/dto/create-customer-payment.dto';
import { DebtPaymentAllocation, DebtsSummary, DebtListItem } from '../../debts/entities/debt.entity';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

/**
 * Customers belong to a shop, not to the warehouse — the route guard keeps the
 * admin out entirely, so every method here can resolve the shop straight from
 * the caller rather than accepting one.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly customersRepo: CustomersRepository,
    private readonly debtsService: DebtsService,
  ) {}

  async create(dto: CreateCustomerDto, user: RequestUser): Promise<Customer> {
    const shopId = user.shopId!;

    // Pre-check for a clean, translatable error; the partial unique index is
    // still the real guard against a concurrent insert.
    if (dto.phone) {
      const existing = await this.customersRepo.findActiveByPhone(shopId, dto.phone);
      if (existing) throw new ConflictException('customer.PHONE_TAKEN');
    }

    return this.customersRepo.insert(shopId, dto);
  }

  async findAll(query: CustomerQueryDto, user: RequestUser): Promise<PaginatedResponse<CustomerListItem>> {
    const result = await this.customersRepo.findPaginated(user.shopId!, query);
    return paginate(result.data, query.page, query.limit, result.total);
  }

  findById(id: number, user: RequestUser): Promise<Customer> {
    return this.requireOwnCustomer(id, user);
  }

  async update(id: number, dto: UpdateCustomerDto, user: RequestUser): Promise<Customer> {
    const customer = await this.requireOwnCustomer(id, user);

    if (dto.phone) {
      const existing = await this.customersRepo.findActiveByPhone(customer.shop_id, dto.phone, id);
      if (existing) throw new ConflictException('customer.PHONE_TAKEN');
    }

    const updated = await this.customersRepo.update(id, dto);
    if (!updated) throw new NotFoundException('customer.NOT_FOUND');

    return updated;
  }

  /**
   * Soft delete. Blocked while the customer still owes money, and equally while
   * the shop owes *them* money back from a cancelled sale — deactivating in
   * either case would drop a real balance off the active list.
   */
  async deactivate(id: number, user: RequestUser): Promise<Customer> {
    await this.requireOwnCustomer(id, user);

    if (await this.customersRepo.hasBlockingDebt(id)) {
      throw new BadRequestException('customer.HAS_OPEN_DEBT');
    }

    const deactivated = await this.customersRepo.deactivate(id);
    if (!deactivated) throw new NotFoundException('customer.NOT_FOUND');

    return deactivated;
  }

  async findDebts(
    id: number,
    query: DebtQueryDto,
    user: RequestUser,
  ): Promise<PaginatedResponse<DebtListItem>> {
    await this.requireOwnCustomer(id, user);
    // findAll re-applies role visibility on top, so the customer filter can
    // only narrow what this user was already allowed to see.
    return this.debtsService.findAll({ ...query, customerId: id } as DebtQueryDto, user);
  }

  async getSummary(id: number, user: RequestUser): Promise<DebtsSummary> {
    await this.requireOwnCustomer(id, user);
    return this.debtsService.getCustomerSummary(id);
  }

  async addPayment(
    id: number,
    dto: CreateCustomerPaymentDto,
    user: RequestUser,
  ): Promise<DebtPaymentAllocation[]> {
    const customer = await this.requireOwnCustomer(id, user);
    return this.debtsService.addCustomerPayment(id, customer.shop_id, dto, user.id);
  }

  /**
   * Looks the customer up already scoped to the caller's shop, so another
   * shop's customer is a 404 rather than a 403 — the id's existence is not
   * information this caller is entitled to.
   */
  private async requireOwnCustomer(id: number, user: RequestUser): Promise<Customer> {
    const customer = await this.customersRepo.findByIdInShop(id, user.shopId!);
    if (!customer) throw new NotFoundException('customer.NOT_FOUND');

    return customer;
  }
}
