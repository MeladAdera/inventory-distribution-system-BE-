import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { DebtsRepository, DebtVisibility } from '../repositories/debts.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
import {
  Debt,
  DebtBalance,
  DebtSource,
  CreditorType,
  DebtListItem,
  DebtsSummary,
  ShopDebtsSummary,
  DebtPaymentAllocation,
  DebtsAgingRow,
  AGING_BUCKETS,
} from '../entities/debt.entity';
import { DebtPayment, PaymentMethod } from '../entities/debt-payment.entity';
import { DebtQueryDto } from '../dto/debt-query.dto';
import { CreateDebtPaymentDto } from '../dto/create-debt-payment.dto';
import { CreateCustomerPaymentDto } from '../dto/create-customer-payment.dto';
import { ReverseDebtPaymentDto } from '../dto/reverse-debt-payment.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { toMinor, fromMinor, InvalidMoneyError } from '../../common/utils/money.util';

/**
 * Which document raised the debt fixes everything else about its shape, so
 * `kind` is the one tag `createDebt` switches on — `creditorType`/`debtorType`
 * cannot serve that role themselves, since a supplier invoice and an order
 * debt are both `debtorType: 'SHOP'`. Keying on `kind` instead means a
 * supplier debt built with an `orderId` on it simply does not typecheck.
 */
export type CreateDebtInput = {
  /** DECIMAL(15,2) string. Must be > 0 — a fully-paid sale gets no debt row. */
  totalAmount: string;
  createdBy: number;
  note?: string;
  /** Reserved for v2 overdue alerts; nothing reads it yet. */
  dueDate?: string;
} & (
  | { kind: 'ORDER'; creditorShopId: number; debtorShopId: number; orderId: number }
  | { kind: 'RECEIPT'; creditorShopId: number; customerId: number; receiptId: number }
  | { kind: 'SUPPLIER_INVOICE'; supplierId: number; debtorShopId: number; invoiceNo?: string }
);

export interface AddPaymentInput {
  /** DECIMAL(15,2) string. Must be > 0 and <= remaining. */
  amount: string;
  method?: PaymentMethod;
  note?: string;
  createdBy: number;
}

export interface ReversePaymentInput {
  reason?: string;
  createdBy: number;
}

/**
 * The shared engine behind both debt flows (warehouse -> shop from an order,
 * shop -> customer from a receipt). Deliberately has no HTTP surface and no
 * knowledge of `RequestUser`: permission and ownership checks belong to the
 * callers that own the source document.
 *
 * Every method takes an **optional** `client`. Passing one composes the work
 * into the caller's transaction — which is required for `createDebt` and
 * `cancelDebt`, since a debt must appear and disappear atomically with the
 * order/receipt that raised it. Omitting it opens a transaction here, which is
 * what the standalone payment endpoints do.
 */
@Injectable()
export class DebtsService {
  constructor(
    private readonly debtsRepo: DebtsRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly db: DatabaseService,
  ) {}

  async createDebt(input: CreateDebtInput, client?: pg.PoolClient): Promise<Debt> {
    const totalMinor = this.parseAmount(input.totalAmount);

    // The DB CHECK rejects this too; catching it here turns a raw constraint
    // violation into a translatable error.
    if (totalMinor <= 0n) {
      throw new BadRequestException('debt.AMOUNT_INVALID');
    }

    return this.run(client, (c) =>
      this.debtsRepo.insert(
        {
          creditorShopId: input.kind === 'SUPPLIER_INVOICE' ? null : input.creditorShopId,
          creditorType: input.kind === 'SUPPLIER_INVOICE' ? 'SUPPLIER' : 'SHOP',
          debtorType: input.kind === 'RECEIPT' ? 'CUSTOMER' : 'SHOP',
          debtorShopId: input.kind === 'ORDER' || input.kind === 'SUPPLIER_INVOICE' ? input.debtorShopId : null,
          customerId: input.kind === 'RECEIPT' ? input.customerId : null,
          supplierId: input.kind === 'SUPPLIER_INVOICE' ? input.supplierId : null,
          invoiceNo: input.kind === 'SUPPLIER_INVOICE' ? (input.invoiceNo ?? null) : null,
          orderId: input.kind === 'ORDER' ? input.orderId : null,
          receiptId: input.kind === 'RECEIPT' ? input.receiptId : null,
          totalAmount: fromMinor(totalMinor),
          createdBy: input.createdBy,
          note: input.note ?? null,
          dueDate: input.dueDate ?? null,
        },
        c,
      ),
    );
  }

  /**
   * Records a collection against a debt.
   *
   * Order of operations matters: the debt row is locked *before* `remaining` is
   * read, so two cashiers collecting at the same moment serialize here and the
   * second one validates against the first one's committed total.
   */
  addPayment(debtId: number, input: AddPaymentInput, client?: pg.PoolClient): Promise<Debt> {
    const amountMinor = this.parseAmount(input.amount);

    return this.run(client, async (c) => {
      const debt = await this.debtsRepo.findByIdForUpdate(debtId, c);
      if (!debt) throw new NotFoundException('debt.NOT_FOUND');
      if (debt.status === 'CANCELLED') throw new BadRequestException('debt.CANCELLED');

      if (amountMinor <= 0n) {
        throw new BadRequestException('debt.AMOUNT_INVALID');
      }

      const remainingMinor = toMinor(debt.total_amount) - toMinor(debt.paid_amount);

      if (remainingMinor === 0n) {
        throw new BadRequestException('debt.ALREADY_PAID');
      }

      // Overpayment is rejected outright rather than becoming a credit balance:
      // a negative debt would need its own refund rules, which this system does
      // not have.
      if (amountMinor > remainingMinor) {
        throw new BadRequestException({
          key: 'debt.AMOUNT_EXCEEDS_REMAINING',
          args: { remaining: fromMinor(remainingMinor) },
        });
      }

      const payment = await this.debtsRepo.insertPayment(
        {
          debtId,
          amount: fromMinor(amountMinor),
          method: input.method ?? 'CASH',
          isReversal: false,
          reversesPaymentId: null,
          note: input.note ?? null,
          createdBy: input.createdBy,
        },
        c,
      );

      const updated = await this.debtsRepo.applyPaymentDelta(debtId, payment.amount, c);

      await this.logDebtEvent(updated, 'PAYMENT', payment.amount, input.createdBy, input.note, c);

      return updated;
    });
  }

  /**
   * Undoes a collection by appending a negative row rather than editing or
   * deleting the original, so the history reads as what actually happened.
   *
   * The debt row is locked first — before the payment is even looked up — so
   * two concurrent reversals of the same payment serialize, and the second one
   * sees the first one's reversal and fails cleanly. The unique index on
   * `reverses_payment_id` stays as a backstop for any future caller that
   * forgets to take the lock.
   */
  reversePayment(
    debtId: number,
    paymentId: number,
    input: ReversePaymentInput,
    client?: pg.PoolClient,
  ): Promise<Debt> {
    return this.run(client, async (c) => {
      const debt = await this.debtsRepo.findByIdForUpdate(debtId, c);
      if (!debt) throw new NotFoundException('debt.NOT_FOUND');
      if (debt.status === 'CANCELLED') throw new BadRequestException('debt.CANCELLED');

      const payment = await this.debtsRepo.findPaymentById(paymentId, debtId, c);
      if (!payment) throw new NotFoundException('debt.PAYMENT_NOT_FOUND');

      // Reversing a reversal would mean re-applying a collection that was
      // already undone. The correct action is a fresh payment.
      if (payment.is_reversal) {
        throw new BadRequestException('debt.NOT_REVERSIBLE');
      }

      const existingReversal = await this.debtsRepo.findReversalOf(paymentId, c);
      if (existingReversal) {
        throw new BadRequestException('debt.ALREADY_REVERSED');
      }

      const deltaMinor = -toMinor(payment.amount);

      const reversal = await this.debtsRepo.insertPayment(
        {
          debtId,
          amount: fromMinor(deltaMinor),
          method: payment.method,
          isReversal: true,
          reversesPaymentId: paymentId,
          note: input.reason ?? null,
          createdBy: input.createdBy,
        },
        c,
      );

      const updated = await this.debtsRepo.applyPaymentDelta(debtId, reversal.amount, c);

      await this.logDebtEvent(updated, 'REVERSAL', reversal.amount, input.createdBy, input.reason, c);

      return updated;
    });
  }

  /**
   * Voids the debt raised by a cancelled order or receipt. Payment rows are
   * kept: a cancelled debt with `paid_amount > 0` is money owed back, which the
   * receivables report surfaces as `refund_due`.
   *
   * Returns null when the source had no live debt — paid in full, or never sold
   * on credit. That is a normal outcome, not an error, so callers can call this
   * unconditionally from their cancel path.
   */
  cancelDebt(
    source: DebtSource,
    cancelledBy: number,
    reason?: string,
    client?: pg.PoolClient,
  ): Promise<Debt | null> {
    return this.run(client, async (c) => {
      const cancelled = await this.debtsRepo.cancelBySource(source, c);
      if (!cancelled) return null;

      await this.logDebtEvent(cancelled, 'CANCELLED', cancelled.paid_amount, cancelledBy, reason, c);

      return cancelled;
    });
  }

  /**
   * Cancels a payable directly by id. Mirrors `cancelDebt`'s shape (locate,
   * cancel conditionally, audit), but a supplier invoice has no source
   * document to look it up through — it was entered directly, so it is
   * cancelled directly. Ownership/permission is the HTTP-facing caller's job,
   * same division as everywhere else in this engine.
   */
  cancelDebtById(
    id: number,
    cancelledBy: number,
    reason?: string,
    client?: pg.PoolClient,
  ): Promise<Debt | null> {
    return this.run(client, async (c) => {
      const cancelled = await this.debtsRepo.cancelById(id, c);
      if (!cancelled) return null;

      await this.logDebtEvent(cancelled, 'CANCELLED', cancelled.paid_amount, cancelledBy, reason, c);

      return cancelled;
    });
  }

  async getBalance(debtId: number): Promise<DebtBalance> {
    const debt = await this.debtsRepo.findById(debtId);
    if (!debt) throw new NotFoundException('debt.NOT_FOUND');

    return this.toBalance(debt);
  }

  findBySource(source: DebtSource): Promise<Debt | null> {
    return this.debtsRepo.findBySource(source);
  }

  findPayments(debtId: number): Promise<DebtPayment[]> {
    return this.debtsRepo.findPaymentsByDebtId(debtId);
  }

  // ---------------------------------------------------------------------------
  // HTTP-facing operations
  //
  // Everything above is the engine: no `RequestUser`, composable into a
  // caller's transaction. The methods below are this module's own endpoints, so
  // they resolve visibility and ownership themselves. Callers that own a source
  // document (orders, receipts) keep using the engine directly and apply their
  // own rules.
  // ---------------------------------------------------------------------------

  /**
   * `creditorType` is required, not defaulted, so every caller states out loud
   * which side of the ledger it wants — see `DebtVisibility.creditorType`.
   */
  async findAll(
    query: DebtQueryDto,
    user: RequestUser,
    creditorType: CreditorType | 'ANY',
  ): Promise<PaginatedResponse<DebtListItem>> {
    const result = await this.debtsRepo.findPaginated(query, this.visibilityFor(user, creditorType));
    return paginate(result.data, query.page, query.limit, result.total);
  }

  async findByIdForUser(id: number, user: RequestUser): Promise<Debt & { remaining: string }> {
    const debt = await this.requireVisibleDebt(id, user);
    return { ...debt, remaining: this.toBalance(debt).remaining };
  }

  async findPaymentsForUser(id: number, user: RequestUser): Promise<DebtPayment[]> {
    await this.requireVisibleDebt(id, user);
    return this.debtsRepo.findPaymentsByDebtId(id);
  }

  getSummary(query: DebtQueryDto, user: RequestUser, creditorType: CreditorType | 'ANY'): Promise<DebtsSummary> {
    return this.debtsRepo.getSummary(query, this.visibilityFor(user, creditorType));
  }

  /**
   * Aging report: what is owed, grouped by how long it has been owed.
   *
   * Every bucket is always returned, even at zero. A chart that gains and loses
   * bars as the data changes is hard to read, and "nothing is 60+ days old" is
   * itself the answer somebody is looking for.
   */
  async getAging(
    query: DebtQueryDto,
    user: RequestUser,
    creditorType: CreditorType | 'ANY',
  ): Promise<DebtsAgingRow[]> {
    const rows = await this.debtsRepo.getAging(query, this.visibilityFor(user, creditorType));
    const byBucket = new Map(rows.map((row) => [row.bucket, row]));

    return AGING_BUCKETS.map(
      (bucket) => byBucket.get(bucket) ?? { bucket, count: 0, amount: '0.00' },
    );
  }

  async getShopSummary(shopId: number, user: RequestUser): Promise<ShopDebtsSummary> {
    if (user.role !== UserRole.WAREHOUSE_ADMIN && user.shopId !== shopId) {
      throw new ForbiddenException('debt.ACCESS_DENIED');
    }

    const [owedByShop, owedToShop] = await Promise.all([
      this.debtsRepo.getSummaryForShopAs('DEBTOR', shopId),
      this.debtsRepo.getSummaryForShopAs('CREDITOR', shopId),
    ]);

    return { shop_id: shopId, owed_by_shop: owedByShop, owed_to_shop: owedToShop };
  }

  /** The live debt raised by an order, for the order-detail screen. */
  async findByOrderForUser(orderId: number, user: RequestUser): Promise<Debt & { remaining: string }> {
    const debt = await this.debtsRepo.findBySource({ type: 'ORDER', id: orderId });
    if (!debt) throw new NotFoundException('debt.NOT_FOUND');

    this.assertReadAccess(debt, user);
    return { ...debt, remaining: this.toBalance(debt).remaining };
  }

  /**
   * Records a collection against an order's debt. Admin-only at the route
   * level: the admin is the one who physically receives the money, so a shop
   * cannot mark itself as paid.
   */
  async addOrderPayment(
    orderId: number,
    dto: CreateDebtPaymentDto,
    user: RequestUser,
  ): Promise<Debt & { remaining: string }> {
    const source: DebtSource = { type: 'ORDER', id: orderId };
    const debt = await this.debtsRepo.findBySource(source);
    if (!debt) throw await this.explainMissingDebt(source);

    const updated = await this.addPayment(debt.id, {
      amount: dto.amount,
      method: dto.method,
      note: dto.note,
      createdBy: user.id,
    });

    return { ...updated, remaining: this.toBalance(updated).remaining };
  }

  /**
   * Collects from a customer across however many debts it takes.
   *
   * With `debtId` it settles that one sale. Without it the money is applied
   * oldest debt first, writing one ledger row per debt it touches — which is
   * how a shop actually works: the customer pays down "what I owe", not one
   * particular receipt.
   *
   * The whole allocation is one transaction. If the amount is more than the
   * customer's total outstanding, nothing is written at all — no partial
   * application, and no credit balance, matching the rule for single debts.
   */
  addCustomerPayment(
    customerId: number,
    creditorShopId: number,
    dto: CreateCustomerPaymentDto,
    userId: number,
  ): Promise<DebtPaymentAllocation[]> {
    const amountMinor = this.parseAmount(dto.amount);

    return this.db.transaction(async (c) => {
      // Locks every candidate row up front, in a fixed order, before any
      // decision is made — see findOpenByCustomerForUpdate.
      const openDebts = await this.debtsRepo.findOpenByCustomerForUpdate(customerId, c);

      const targets = dto.debtId !== undefined
        ? openDebts.filter((debt) => debt.id === dto.debtId)
        : openDebts;

      if (targets.length === 0) {
        // Either the customer owes nothing, or the named debt is settled,
        // cancelled, or belongs to somebody else.
        throw new NotFoundException(dto.debtId !== undefined ? 'debt.NOT_FOUND' : 'debt.NO_OPEN_DEBTS');
      }

      // Ownership is checked after the filter so a debt from another shop is
      // indistinguishable from one that does not exist.
      for (const debt of targets) {
        if (debt.creditor_shop_id !== creditorShopId) {
          throw new NotFoundException('debt.NOT_FOUND');
        }
      }

      const totalRemaining = targets.reduce(
        (sum, debt) => sum + toMinor(debt.total_amount) - toMinor(debt.paid_amount),
        0n,
      );

      if (amountMinor > totalRemaining) {
        throw new BadRequestException({
          key: 'debt.AMOUNT_EXCEEDS_REMAINING',
          args: { remaining: fromMinor(totalRemaining) },
        });
      }

      const allocations: DebtPaymentAllocation[] = [];
      let left = amountMinor;

      for (const debt of targets) {
        if (left === 0n) break;

        const debtRemaining = toMinor(debt.total_amount) - toMinor(debt.paid_amount);
        const share = left < debtRemaining ? left : debtRemaining;

        // Reuses the single-debt path so each slice gets the same validation,
        // status derivation and audit row. Re-locking inside the same
        // transaction is a no-op.
        const updated = await this.addPayment(
          debt.id,
          { amount: fromMinor(share), method: dto.method, note: dto.note, createdBy: userId },
          c,
        );

        allocations.push({
          debt_id: debt.id,
          receipt_id: updated.receipt_id,
          amount: fromMinor(share),
          status: updated.status,
          remaining: this.toBalance(updated).remaining,
        });

        left -= share;
      }

      return allocations;
    });
  }

  getCustomerSummary(customerId: number): Promise<DebtsSummary> {
    return this.debtsRepo.getSummaryForCustomer(customerId);
  }

  async reversePaymentForUser(
    debtId: number,
    paymentId: number,
    dto: ReverseDebtPaymentDto,
    user: RequestUser,
  ): Promise<Debt> {
    const debt = await this.debtsRepo.findById(debtId);
    if (!debt) throw new NotFoundException('debt.NOT_FOUND');

    this.assertCanReverse(debt, user);

    return this.reversePayment(debtId, paymentId, { reason: dto.reason, createdBy: user.id });
  }

  /**
   * Cancels a supplier bill entered by mistake. Payables only — a receivable
   * must be cancelled through its order/receipt (`cancelDebt`), or that
   * source document would keep believing it has a live debt.
   */
  async cancelSupplierDebtForUser(
    id: number,
    dto: ReverseDebtPaymentDto,
    user: RequestUser,
  ): Promise<Debt> {
    const debt = await this.debtsRepo.findById(id);
    if (!debt) throw new NotFoundException('debt.NOT_FOUND');

    if (debt.creditor_type !== 'SUPPLIER') {
      throw new BadRequestException('debt.NOT_CANCELLABLE_BY_ID');
    }

    // Cancelling a part-paid bill is a strictly bigger action than undoing
    // one payment on it, so it reuses the same authority check rather than a
    // weaker one.
    this.assertCanReverse(debt, user);

    const cancelled = await this.cancelDebtById(id, user.id, dto.reason);
    if (!cancelled) throw new BadRequestException('debt.ALREADY_CANCELLED');

    return cancelled;
  }

  /**
   * Why there is no live debt for a source. "The sale was voided" and "the sale
   * was never on credit" are different answers, and the cashier staring at the
   * screen needs the right one — a bare 404 would send them looking for a
   * payment that was never due.
   */
  private async explainMissingDebt(source: DebtSource): Promise<Error> {
    const previous = await this.debtsRepo.findAnyBySource(source);

    return previous
      ? new BadRequestException('debt.CANCELLED')
      : new NotFoundException('debt.NOT_FOUND');
  }

  private async requireVisibleDebt(id: number, user: RequestUser): Promise<Debt> {
    const debt = await this.debtsRepo.findById(id);
    if (!debt) throw new NotFoundException('debt.NOT_FOUND');

    this.assertReadAccess(debt, user);
    return debt;
  }

  private visibilityFor(user: RequestUser, creditorType: CreditorType | 'ANY'): DebtVisibility {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return { creditorType };

    return {
      creditorType,
      shopId: user.shopId ?? undefined,
      // An employee runs the shop's credit sales but has no business seeing
      // what the shop owes the warehouse.
      forceDebtorType: user.role === UserRole.EMPLOYEE ? 'CUSTOMER' : undefined,
    };
  }

  private assertReadAccess(debt: Debt, user: RequestUser): void {
    if (user.role === UserRole.WAREHOUSE_ADMIN) return;

    // A user can have no shop yet. Without this guard, `null === null` below
    // would make such a user "a party" to every payable — creditor_shop_id is
    // null there too, for an unrelated reason (no creditor shop, a supplier
    // owns that side). Not possible before creditor_shop_id became nullable.
    if (user.shopId === null) throw new ForbiddenException('debt.ACCESS_DENIED');

    const isParty = debt.debtor_shop_id === user.shopId
                 || (debt.creditor_shop_id !== null && debt.creditor_shop_id === user.shopId);
    if (!isParty) throw new ForbiddenException('debt.ACCESS_DENIED');

    // Employees run the shop's credit sales but have no business seeing what
    // the shop owes elsewhere — that covers both an order-debt and a supplier
    // bill. Both already imply debtor_type SHOP; creditor_type is checked too
    // so the rule reads as a deliberate choice about payables, not something
    // that happens to fall out of the debtor-side test.
    if (user.role === UserRole.EMPLOYEE &&
        (debt.creditor_type === 'SUPPLIER' || debt.debtor_type === 'SHOP')) {
      throw new ForbiddenException('debt.ACCESS_DENIED');
    }
  }

  /**
   * Reversal makes collected money disappear from the balance, so it is limited
   * to whoever actually received it: the admin for order debts, the shop owner
   * for their own customer debts. Employees never reverse.
   *
   * A supplier payable is dispatched first and separately: `debt.debtor_type`
   * is 'SHOP' there too (same as an order debt), so it would otherwise fall
   * into the order-debt branch below and demand WAREHOUSE_ADMIN — blocking a
   * shop owner from undoing a mistaken payment to their own supplier.
   */
  private assertCanReverse(debt: Debt, user: RequestUser): void {
    if (debt.creditor_type === 'SUPPLIER') {
      // The supplier received the money, and the supplier is outside this
      // system — so the right authority is whoever paid it: the owner of the
      // shop that owes. The warehouse is a shops row too, so its admin is
      // covered by the same test for the warehouse's own payables. No global
      // override for other shops' payables — same "a shop's business is its
      // own" rule as customer debts.
      if (debt.debtor_shop_id === user.shopId &&
          (user.role === UserRole.SHOP_OWNER || user.role === UserRole.WAREHOUSE_ADMIN)) {
        return;
      }
      throw new ForbiddenException('debt.ACCESS_DENIED');
    }

    if (debt.debtor_type === 'SHOP') {
      if (user.role !== UserRole.WAREHOUSE_ADMIN) {
        throw new ForbiddenException('debt.ACCESS_DENIED');
      }
      return;
    }

    if (user.role === UserRole.SHOP_OWNER && debt.creditor_shop_id === user.shopId) return;

    throw new ForbiddenException('debt.ACCESS_DENIED');
  }

  /** `remaining` is derived on read so it can never drift from the ledger. */
  toBalance(debt: Debt): DebtBalance {
    return {
      debt_id: debt.id,
      total_amount: debt.total_amount,
      paid_amount: debt.paid_amount,
      remaining: fromMinor(toMinor(debt.total_amount) - toMinor(debt.paid_amount)),
      status: debt.status,
    };
  }

  /**
   * Runs `fn` inside the caller's transaction when one is supplied, otherwise
   * opens its own. Both branches guarantee the work is atomic — the difference
   * is only whether it commits together with the caller's changes.
   */
  private run<T>(
    client: pg.PoolClient | undefined,
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    return client ? fn(client) : this.db.transaction(fn);
  }

  /** Turns a malformed money string into a translatable error, not a raw throw. */
  private parseAmount(value: string): bigint {
    try {
      return toMinor(value);
    } catch (error) {
      if (error instanceof InvalidMoneyError) {
        throw new BadRequestException('debt.AMOUNT_INVALID');
      }
      throw error;
    }
  }

  private logDebtEvent(
    debt: Debt,
    action: 'PAYMENT' | 'REVERSAL' | 'CANCELLED',
    amount: string,
    userId: number,
    notes: string | undefined,
    client: pg.PoolClient,
  ): Promise<unknown> {
    return this.auditLogsService.log(
      {
        // creditor_shop_id is null on a payable (the creditor is a supplier,
        // not a shop) — fall back to debtor_shop_id so the shop that made the
        // payment can still see its own audit row. chk_debts_party_shape
        // guarantees at least one of the two is always set.
        shop_id: debt.creditor_shop_id ?? debt.debtor_shop_id,
        user_id: userId,
        type: 'DEBT',
        action,
        entity_type: 'debt',
        entity_id: debt.id,
        // Links the audit row back to the sale for customer debts; order-backed
        // and supplier-payable debts have no receipt, hence the undefined.
        receipt_id: debt.receipt_id ?? undefined,
        // audit_logs.amount is a display field on a DECIMAL(15,2) column, so
        // the float round-trip is safe here — unlike the ledger itself, nothing
        // does arithmetic on it.
        amount: Number(amount),
        // A payable has no receipt to identify it by, so fold its invoice
        // number into the note instead of losing it from the audit trail.
        notes: debt.invoice_no ? `${notes ?? ''} (invoice ${debt.invoice_no})`.trim() : notes,
      },
      client,
    );
  }
}
