import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { ShiftsRepository, ShopClock, TemplateWithHours } from '../repositories/shifts.repository';
import { UpdateOpeningHoursDto } from '../dto/update-opening-hours.dto';
import { CreateShiftTemplateDto, UpdateShiftTemplateDto } from '../dto/shift-template.dto';
import { AssignEmployeesDto } from '../dto/assign-employees.dto';
import { OpenShiftDto } from '../dto/open-shift.dto';
import { ShiftSessionWithNames } from '../entities/shift-session.entity';
import { UsersRepository } from '../../users/repositories/users.repository';
import { AuditLogsService } from '../../audit-logs/services/audit-logs.service';
import { CloseShiftDto } from '../dto/close-shift.dto';
import {
  ShiftReport,
  ShiftSessionDetail,
  ShiftSessionListItem,
} from '../entities/shift-session.entity';
import { ShiftReportQueryDto, ShiftSessionQueryDto } from '../dto/shift-query.dto';
import { fromMinor, toMinor } from '../../common/utils/money.util';
import { paginate, PaginatedResponse } from '../../common/utils/pagination.util';
import { UserRole } from '../../common/enums/user-role.enum';
import { OpeningHoursWeek, ShopOpeningHours } from '../entities/opening-hours.entity';
import { ShiftTemplate, ShiftTemplateWithDuration } from '../entities/shift-template.entity';
import {
  contains,
  durationMinutes,
  MINUTES_PER_DAY,
  openingWindow,
  overlaps,
  slotWindow,
  toTimeString,
  TimeWindow,
} from '../utils/shift-time.util';
import { RequestUser } from '../../common/interfaces/request-user.interface';

/** Sunday..Saturday, matching JavaScript's `Date.getDay()`. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** The client's requirement: a weekday splits into at most four parts. */
export const MAX_SLOTS_PER_DAY = 4;

/**
 * What an unsaved weekday looks like. Closed, so a shop that has never set its
 * hours reads as "not trading" rather than "trading from midnight to midnight",
 * which would let shifts be created against hours nobody chose.
 */
const UNSET_DAY = { open_time: '00:00:00', close_time: '00:00:00', is_closed: true };

/**
 * Whether the runtime recognises an IANA zone name. `Intl.DateTimeFormat`
 * throws `RangeError` on an unknown zone, which is the only check available
 * without shipping a zone database of our own.
 */
function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Normalises `'08:00'` to `'08:00:00'` so stored and echoed values match. */
function toSqlTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly shiftsRepo: ShiftsRepository,
    private readonly usersRepo: UsersRepository,
    private readonly auditLogsService: AuditLogsService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Every shift endpoint belongs to exactly one shop, and that shop comes from
   * the token — never from the request body — matching how receipts, debts and
   * customers are scoped. A `WAREHOUSE_ADMIN` has no shop at all, so there is
   * no schedule for them to read; the routes exclude the role, and this is the
   * backstop if that ever changes.
   */
  private shopIdOf(user: RequestUser): number {
    if (user.shopId === null) throw new ForbiddenException('shift.SHOP_REQUIRED');
    return user.shopId;
  }

  /**
   * The full week, always seven days. Missing rows are filled with a closed
   * placeholder so the client renders one shape whether or not the owner has
   * saved anything yet.
   */
  async getOpeningHours(user: RequestUser): Promise<OpeningHoursWeek> {
    const shopId = this.shopIdOf(user);

    const [stored, timezone] = await Promise.all([
      this.shiftsRepo.findOpeningHours(shopId),
      this.shiftsRepo.findTimezone(shopId),
    ]);

    const byWeekday = new Map(stored.map((day) => [day.weekday, day]));

    const days: ShopOpeningHours[] = WEEKDAYS.map(
      (weekday) => byWeekday.get(weekday) ?? { shop_id: shopId, weekday, ...UNSET_DAY },
    );

    // findTimezone only returns null for a shop that does not exist, which a
    // valid token cannot point at — the column is NOT NULL with a default.
    return { timezone: timezone ?? 'Asia/Damascus', days };
  }

  async updateOpeningHours(dto: UpdateOpeningHoursDto, user: RequestUser): Promise<OpeningHoursWeek> {
    const shopId = this.shopIdOf(user);

    // Seven entries is already guaranteed by the DTO; this catches the shape
    // that passes the count but is still not a week — a repeated weekday,
    // which would silently drop whichever day it displaced.
    const weekdays = new Set(dto.days.map((day) => day.weekday));
    if (weekdays.size !== WEEKDAYS.length) {
      throw new BadRequestException('shift.OPENING_HOURS_INCOMPLETE');
    }

    for (const day of dto.days) {
      // Equal open and close is the one window with no readable meaning: it is
      // either an empty day or a 24-hour one, and guessing either way would
      // decide the shop's trading hours for them. A real 24-hour day is
      // '00:00' to '24:00'; a closed one sets isClosed.
      if (!day.isClosed && toSqlTime(day.openTime) === toSqlTime(day.closeTime)) {
        throw new BadRequestException({
          key: 'shift.INVALID_OPENING_HOURS',
          args: { weekday: day.weekday },
        });
      }
    }

    if (dto.timezone !== undefined && !isValidTimezone(dto.timezone)) {
      throw new BadRequestException({ key: 'shift.INVALID_TIMEZONE', args: { timezone: dto.timezone } });
    }

    await this.db.transaction(async (client) => {
      if (dto.timezone !== undefined) {
        await this.shiftsRepo.updateTimezone(shopId, dto.timezone, client);
      }

      await this.shiftsRepo.replaceOpeningHours(
        shopId,
        dto.days.map((day) => ({
          weekday: day.weekday,
          openTime: toSqlTime(day.openTime),
          closeTime: toSqlTime(day.closeTime),
          isClosed: day.isClosed ?? false,
        })),
        client,
      );
    });

    return this.getOpeningHours(user);
  }

  // ── Shift templates ────────────────────────────────────────────────────────

  /** The week's plan, ordered by weekday then position within the day. */
  async getTemplates(user: RequestUser): Promise<ShiftTemplateWithDuration[]> {
    const shopId = this.shopIdOf(user);
    const templates = await this.shiftsRepo.findTemplates(shopId);

    // Length is derived per day, because how long a window lasts depends on
    // whether it crosses midnight, which only the day's opening hours settle.
    const week = await this.shiftsRepo.findOpeningHours(shopId);
    const hoursByWeekday = new Map(week.map((day) => [day.weekday, day]));

    return templates.map((template) => ({
      ...template,
      duration_minutes: this.durationOf(template, hoursByWeekday.get(template.weekday)),
    }));
  }

  /**
   * Replaces a slot's whole rota.
   *
   * Several employees on one slot is deliberate: a weekly template is worked
   * by whoever is on rota that week, so both halves of a rotation belong on it,
   * and a colleague covering a sick shift should not be flagged unscheduled.
   * How many people work at the same moment is settled by the one-open-session
   * rule, not by this list.
   */
  async assignEmployees(
    templateId: number,
    dto: AssignEmployeesDto,
    user: RequestUser,
  ): Promise<ShiftTemplateWithDuration> {
    const shopId = this.shopIdOf(user);

    // Naming someone twice says nothing the first mention did not, so it is
    // reduced rather than refused — a slip in the client, not a bad save.
    const userIds = [...new Set(dto.userIds)];

    if (userIds.length > 0) {
      const eligible = new Set(await this.usersRepo.findActiveEmployeeIdsInShop(userIds, shopId));
      // Reports the first id that failed rather than "one of these is wrong":
      // deactivated staff, another shop's staff and the owner themselves are
      // all rejected here, and the owner needs to know which name to fix.
      const rejected = userIds.find((id) => !eligible.has(id));

      if (rejected !== undefined) {
        throw new BadRequestException({ key: 'shift.ASSIGNEE_NOT_EMPLOYEE', args: { userId: rejected } });
      }
    }

    return this.db.transaction(async (client) => {
      const template = await this.shiftsRepo.findTemplateById(templateId, shopId, client);
      if (!template) throw new NotFoundException('shift.TEMPLATE_NOT_FOUND');

      await this.shiftsRepo.replaceAssignees(templateId, userIds, client);

      const day = await this.shiftsRepo.findOpeningHoursForDay(shopId, template.weekday, client);

      return {
        ...template,
        duration_minutes: this.durationOf(template, day ?? undefined),
        assignees: await this.shiftsRepo.findAssignees(templateId, client),
      };
    });
  }

  async createTemplate(dto: CreateShiftTemplateDto, user: RequestUser): Promise<ShiftTemplateWithDuration> {
    const shopId = this.shopIdOf(user);

    return this.db.transaction(async (client) => {
      // Before reading the day's occupied slots, so the index this picks is
      // still free when it writes. See `lockShop`.
      await this.shiftsRepo.lockShop(shopId, client);

      const { opening, siblings } = await this.loadDay(shopId, dto.weekday, client);

      if (siblings.length >= MAX_SLOTS_PER_DAY) {
        throw new BadRequestException({
          key: 'shift.SLOT_LIMIT_REACHED',
          args: { max: MAX_SLOTS_PER_DAY },
        });
      }

      const slot = this.buildSlot(dto.startTime, dto.endTime, opening);
      this.assertFitsDay(slot, opening, siblings, null);

      const created = await this.shiftsRepo.insertTemplate(
        shopId,
        {
          weekday: dto.weekday,
          slotIndex: this.firstFreeSlotIndex(siblings),
          name: dto.name,
          startTime: toSqlTime(dto.startTime),
          endTime: toSqlTime(dto.endTime),
        },
        client,
      );

      // A slot nobody is on yet — the owner assigns after creating it.
      return { ...created, duration_minutes: durationMinutes(slot), assignees: [] };
    });
  }

  async updateTemplate(
    id: number,
    dto: UpdateShiftTemplateDto,
    user: RequestUser,
  ): Promise<ShiftTemplateWithDuration> {
    const shopId = this.shopIdOf(user);

    return this.db.transaction(async (client) => {
      await this.shiftsRepo.lockShop(shopId, client);

      const existing = await this.shiftsRepo.findTemplateById(id, shopId, client);
      if (!existing) throw new NotFoundException('shift.TEMPLATE_NOT_FOUND');

      const { opening, siblings } = await this.loadDay(shopId, existing.weekday, client);

      // Fall back to what is stored, so changing only the start time is still
      // validated as the whole window it will become.
      const startTime = dto.startTime ?? existing.start_time;
      const endTime = dto.endTime ?? existing.end_time;

      const slot = this.buildSlot(startTime, endTime, opening);
      // Excluded from its own overlap check — a slot always collides with the
      // stored copy of itself.
      this.assertFitsDay(slot, opening, siblings, existing.id);

      const updated = await this.shiftsRepo.updateTemplate(
        id,
        shopId,
        {
          name: dto.name,
          startTime: dto.startTime !== undefined ? toSqlTime(dto.startTime) : undefined,
          endTime: dto.endTime !== undefined ? toSqlTime(dto.endTime) : undefined,
        },
        client,
      );

      if (!updated) throw new NotFoundException('shift.TEMPLATE_NOT_FOUND');

      return {
        ...updated,
        duration_minutes: durationMinutes(slot),
        assignees: await this.shiftsRepo.findAssignees(id, client),
      };
    });
  }

  async deleteTemplate(id: number, user: RequestUser): Promise<void> {
    const shopId = this.shopIdOf(user);

    await this.db.transaction(async (client) => {
      const removed = await this.shiftsRepo.deactivateTemplate(id, shopId, client);
      if (!removed) throw new NotFoundException('shift.TEMPLATE_NOT_FOUND');

      // Retiring a slot is a soft delete, so the FK cascade never fires and
      // its rota would sit pointing at a slot no grid shows. Clearing it here
      // also means the position, once reused, starts with nobody on it.
      await this.shiftsRepo.replaceAssignees(id, [], client);
    });
  }

  /**
   * The day's trading window and its existing slots — everything the three
   * rules are decided against, fetched once so they all judge the same state.
   */
  private async loadDay(
    shopId: number,
    weekday: number,
    client: pg.PoolClient,
  ): Promise<{ opening: TimeWindow; siblings: ShiftTemplate[] }> {
    const day = await this.shiftsRepo.findOpeningHoursForDay(shopId, weekday, client);

    // An unsaved day reads as closed, so shifts cannot be hung on hours nobody
    // has chosen — the owner sets the trading week first.
    if (!day || day.is_closed) {
      throw new BadRequestException({ key: 'shift.DAY_CLOSED', args: { weekday } });
    }

    return {
      opening: openingWindow(day.open_time, day.close_time),
      siblings: await this.shiftsRepo.findTemplatesForDay(shopId, weekday, client),
    };
  }

  private buildSlot(startTime: string, endTime: string, opening: TimeWindow): TimeWindow {
    // Equal ends would otherwise resolve to a full 24 hours, silently turning
    // a typo into a day-long shift.
    if (toSqlTime(startTime) === toSqlTime(endTime)) {
      throw new BadRequestException('shift.INVALID_SLOT_WINDOW');
    }

    return slotWindow(startTime, endTime, opening);
  }

  /** Rules 2 and 3: inside the trading window, and clear of every other slot. */
  private assertFitsDay(
    slot: TimeWindow,
    opening: TimeWindow,
    siblings: ShiftTemplate[],
    excludeId: number | null,
  ): void {
    if (!contains(opening, slot)) {
      throw new BadRequestException({
        key: 'shift.OUTSIDE_OPENING_HOURS',
        args: { open: toTimeString(opening.start), close: toTimeString(opening.end) },
      });
    }

    for (const sibling of siblings) {
      if (sibling.id === excludeId) continue;

      if (overlaps(slot, slotWindow(sibling.start_time, sibling.end_time, opening))) {
        throw new BadRequestException({ key: 'shift.SLOTS_OVERLAP', args: { name: sibling.name } });
      }
    }
  }

  /**
   * Lowest unused position, rather than "count + 1": deleting slot 2 of three
   * must free position 2, or the day would run out of positions long before it
   * runs out of its four shifts.
   */
  private firstFreeSlotIndex(siblings: ShiftTemplate[]): number {
    const taken = new Set(siblings.map((sibling) => sibling.slot_index));

    for (let index = 1; index <= MAX_SLOTS_PER_DAY; index++) {
      if (!taken.has(index)) return index;
    }

    // Unreachable: the caller checks the slot limit first, under the same lock.
    throw new BadRequestException({ key: 'shift.SLOT_LIMIT_REACHED', args: { max: MAX_SLOTS_PER_DAY } });
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  /**
   * The shop's open shift, or null when nobody is clocked in.
   *
   * One endpoint answers both "is anyone working" and "am I working", because
   * one shop has one open session: the client compares `user_id` with its own.
   */
  getOpenSession(user: RequestUser): Promise<ShiftSessionWithNames | null> {
    return this.shiftsRepo.findOpenSession(this.shopIdOf(user));
  }

  async openShift(dto: OpenShiftDto, user: RequestUser): Promise<ShiftSessionWithNames> {
    const shopId = this.shopIdOf(user);

    return this.db.transaction(async (client) => {
      // Serializes the check below against a concurrent open, so two people
      // starting at once get a readable "Ahmad's shift is open" rather than a
      // unique-violation from the index underneath.
      await this.shiftsRepo.lockShop(shopId, client);

      const alreadyOpen = await this.shiftsRepo.findOpenSession(shopId, client);
      if (alreadyOpen) {
        // Named, so the app can say whose drawer needs counting rather than
        // leaving the next employee with a dead end.
        throw new ConflictException({
          key: 'shift.SESSION_ALREADY_OPEN',
          args: { name: alreadyOpen.user_name },
        });
      }

      const clock = await this.shiftsRepo.findShopClock(shopId, client);
      if (!clock) throw new NotFoundException('shift.SHOP_REQUIRED');

      const running = await this.findRunningTemplate(shopId, clock, client);

      // Off-schedule covers both "no shift is running now" and "a shift is
      // running but this is not their slot". Either way the session opens —
      // the owner gets visibility, the employee never gets stuck.
      const isOffSchedule =
        running === null || !(await this.shiftsRepo.isAssignedTo(running.id, user.id, client));

      const session = await this.shiftsRepo.insertSession(
        shopId,
        user.id,
        running?.id ?? null,
        dto.openingFloat,
        isOffSchedule,
        client,
      );

      // Shift events go in the same trail as the sales and payments they
      // explain, so an owner looking at a shortage sees the clock-in beside
      // the receipts rather than in a screen of its own.
      await this.auditLogsService.log(
        {
          shop_id: shopId,
          user_id: user.id,
          type: 'SHIFT',
          action: 'CLOCK_IN',
          entity_type: 'shift_session',
          entity_id: session.id,
          amount: Number(session.opening_float),
        },
        client,
      );

      // Re-read through the same query the GET uses, so opening a shift and
      // polling for it return an identical shape with the names resolved.
      const opened = await this.shiftsRepo.findOpenSession(shopId, client);
      if (!opened) throw new ConflictException('shift.SESSION_NOT_OPEN');

      return opened;
    });
  }

  // ── Reporting ──────────────────────────────────────────────────────────────

  /** The owner's shift history, newest trading day first. */
  async findSessions(
    query: ShiftSessionQueryDto,
    user: RequestUser,
  ): Promise<PaginatedResponse<ShiftSessionListItem>> {
    const shopId = this.shopIdOf(user);
    const result = await this.shiftsRepo.findSessionsPaginated(shopId, query);

    return paginate(result.data, query.page, query.limit, result.total);
  }

  /**
   * One shift with the receipts that explain it.
   *
   * Readable by the owner, or by the employee who worked it — someone accused
   * of being short has to be able to see the sales the figure was built from.
   */
  async findSessionById(id: number, user: RequestUser): Promise<ShiftSessionDetail> {
    const shopId = this.shopIdOf(user);

    const session = await this.shiftsRepo.findSessionWithNames(id, shopId);
    if (!session) throw new NotFoundException('shift.SESSION_NOT_FOUND');

    if (user.role !== UserRole.SHOP_OWNER && session.user_id !== user.id) {
      throw new ForbiddenException('shift.SESSION_ACCESS_DENIED');
    }

    const receipts = await this.shiftsRepo.findReceiptsForSession(id);

    // Counted from the same rows the list shows, and deliberately not from the
    // frozen cash columns: these describe what was sold, which is a different
    // question from what ended up in the drawer.
    const counted = receipts.filter((receipt) => !receipt.is_free && !receipt.is_cancelled);
    const salesTotal = counted.reduce((sum, receipt) => sum + toMinor(receipt.total_price), 0n);

    return {
      ...session,
      receipt_count: counted.length,
      sales_total: fromMinor(salesTotal),
      receipts,
    };
  }

  /**
   * Money grouped by employee and by shift.
   *
   * Per-employee cash accuracy is meaningful only because one employee works
   * one shift: a difference belongs to a person, not to a crowd sharing a till.
   */
  async getReport(query: ShiftReportQueryDto, user: RequestUser): Promise<ShiftReport> {
    const shopId = this.shopIdOf(user);

    const [byEmployee, byShift] = await Promise.all([
      this.shiftsRepo.reportByEmployee(shopId, query.from, query.to),
      this.shiftsRepo.reportByShift(shopId, query.from, query.to),
    ]);

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      by_employee: byEmployee,
      by_shift: byShift,
    };
  }

  /**
   * Ends a shift: the person's count against the server's, frozen.
   *
   * Anyone in the shop may close, not only the session's own user. The handover
   * needs it — if Ahmad goes home without clocking out, Sara has to be able to
   * count the drawer and start her own shift rather than being locked out until
   * the owner appears. `closed_by` records who actually counted, so the owner
   * sees that it was not Ahmad and knows to ask.
   */
  async closeShift(id: number, dto: CloseShiftDto, user: RequestUser): Promise<ShiftSessionWithNames> {
    const shopId = this.shopIdOf(user);

    return this.db.transaction(async (client) => {
      const session = await this.shiftsRepo.findSessionWithNames(id, shopId, client);
      if (!session) throw new NotFoundException('shift.SESSION_NOT_FOUND');
      if (session.status !== 'OPEN') throw new ConflictException('shift.SESSION_NOT_OPEN');

      const totals = await this.shiftsRepo.findCashTotals(id, client);
      if (!totals) throw new NotFoundException('shift.SESSION_NOT_FOUND');

      // Minor units throughout: this figure decides whether someone is accused
      // of being short, so it never touches a float.
      const expectedMinor =
        toMinor(totals.opening_float) +
        toMinor(totals.cash_sales) +
        toMinor(totals.collections) -
        toMinor(totals.payouts);

      const countedMinor = toMinor(dto.countedCash);
      const differenceMinor = countedMinor - expectedMinor;

      const expectedCash = fromMinor(expectedMinor);
      const cashDifference = fromMinor(differenceMinor);

      const closed = await this.shiftsRepo.closeSession(
        id,
        shopId,
        {
          countedCash: dto.countedCash,
          expectedCash,
          cashDifference,
          // Frozen alongside the total, so a shift read months later still
          // shows the working and not just the answer.
          cashSales: totals.cash_sales,
          cashCollections: totals.collections,
          cashPayouts: totals.payouts,
          closedBy: user.id,
          notes: dto.notes,
        },
        client,
      );

      // The UPDATE is conditional on the row still being open, so losing this
      // race means someone else counted the drawer first. Their count stands.
      if (!closed) throw new ConflictException('shift.SESSION_NOT_OPEN');

      await this.auditLogsService.log(
        {
          shop_id: shopId,
          user_id: user.id,
          type: 'SHIFT',
          action: 'CLOCK_OUT',
          entity_type: 'shift_session',
          entity_id: id,
          // The difference, not the total: a shortage is the part of a close
          // worth finding in a list of events.
          amount: Number(cashDifference),
          notes: dto.notes,
        },
        client,
      );

      // Exactly the shape every other session read returns — the frozen
      // columns already carry the working, so a separate breakdown object
      // would be the same three figures twice under two sets of names.
      return {
        ...closed,
        user_name: session.user_name,
        shift_template_name: session.shift_template_name,
      };
    });
  }

  /**
   * Which session a sale or collection belongs to.
   *
   * The shop's open shift, not the seller's own: when the owner rings something
   * up during Ahmad's shift, the cash physically lands in Ahmad's drawer, so
   * that is where it has to count. Who sold it is a separate question, answered
   * by `receipts.created_by`.
   *
   * An explicit id overrides, and exists for offline replay. A sale rung up
   * offline and sent an hour later has to name the session it was made in, or
   * it would attach to whichever shift happens to be open when it arrives.
   *
   * Null when no shift is open — selling without one stays possible, the money
   * simply belongs to no drawer.
   */
  async resolveForSale(
    shopId: number,
    explicitId: number | undefined,
    client?: pg.PoolClient,
  ): Promise<number | null> {
    // A named session is accepted even once closed. That is the whole point of
    // naming one: an offline queue can drain long after the shift ended, and
    // the sale genuinely happened in it. Refusing would reject a real sale and
    // lose it, which is worse than a closed shift's frozen total no longer
    // matching — that figure is a snapshot of what was known at the count, and
    // the late arrival stays visible hanging off the session it belongs to.
    if (explicitId !== undefined) {
      return this.assertSessionInShop(explicitId, shopId, false, client);
    }

    const open = await this.shiftsRepo.findOpenSession(shopId, client);
    return open?.id ?? null;
  }

  /**
   * The same check without the fallback: null unless the caller names a session.
   *
   * For money the shop pays *out*. An owner settling a supplier bill may take
   * the cash from the till or from the safe, and the two are indistinguishable
   * from here. Guessing the open shift would make the employee on it look short
   * by that amount for a movement they never touched — the exact silent
   * misattribution this feature exists to prevent. So the caller must say, and
   * saying nothing means "not from any shift".
   */
  resolveExplicit(
    shopId: number,
    explicitId: number | undefined,
    client?: pg.PoolClient,
  ): Promise<number | null> {
    if (explicitId === undefined) return Promise.resolve(null);

    // Open is required here, unlike a sale. These movements are made by a
    // person standing at the till right now, so a closed shift is a mistyped
    // id rather than a late arrival — and putting cash into a drawer that has
    // already been counted would break a total nobody will re-check.
    return this.assertSessionInShop(explicitId, shopId, true, client);
  }

  private async assertSessionInShop(
    id: number,
    shopId: number,
    requireOpen: boolean,
    client?: pg.PoolClient,
  ): Promise<number> {
    const session = await this.shiftsRepo.findSessionInShop(id, shopId, client);

    // Another shop's session reads as missing rather than forbidden, matching
    // how every other cross-shop lookup here behaves.
    if (!session) throw new NotFoundException('shift.SESSION_NOT_FOUND');

    if (requireOpen && session.status !== 'OPEN') {
      throw new ConflictException('shift.SESSION_NOT_OPEN');
    }

    return session.id;
  }

  /**
   * Which slot is running right now, or null.
   *
   * Two weekdays are considered, because a shift that began before midnight is
   * still running after it: at 00:30 on Saturday, Friday's 22:00-02:00 slot is
   * the one being worked. Yesterday's windows are therefore probed against the
   * current minute *plus a day*, which is the same frame `slotWindow` positions
   * them in.
   *
   * At most one can match: templates on a weekday may not overlap, and two
   * different weekdays' slots both containing this instant would mean one
   * spilled past its own trading window, which containment already forbids.
   */
  private async findRunningTemplate(
    shopId: number,
    clock: ShopClock,
    client: pg.PoolClient,
  ): Promise<TemplateWithHours | null> {
    const yesterday = (clock.weekday + 6) % 7;

    const candidates = await this.shiftsRepo.findTemplatesWithHours(
      shopId,
      [clock.weekday, yesterday],
      client,
    );

    for (const candidate of candidates) {
      if (candidate.is_closed) continue;

      const opening = openingWindow(candidate.open_time, candidate.close_time);
      const window = slotWindow(candidate.start_time, candidate.end_time, opening);
      const probe = candidate.weekday === clock.weekday ? clock.minutes : clock.minutes + MINUTES_PER_DAY;

      // Half-open, matching every other window comparison here: a shift that
      // ends exactly now has ended, and the next one has started.
      if (probe >= window.start && probe < window.end) return candidate;
    }

    return null;
  }

  private durationOf(template: ShiftTemplate, day: ShopOpeningHours | undefined): number {
    // A slot whose day was later closed keeps its stored times; measure it
    // against itself so the grid still renders a length instead of failing.
    const opening = day
      ? openingWindow(day.open_time, day.close_time)
      : openingWindow(template.start_time, template.end_time);

    return durationMinutes(slotWindow(template.start_time, template.end_time, opening));
  }
}
