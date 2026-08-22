import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as pg from 'pg';
import { DatabaseService } from '../../database/database.service';
import { ShiftsRepository } from '../repositories/shifts.repository';
import { UpdateOpeningHoursDto } from '../dto/update-opening-hours.dto';
import { CreateShiftTemplateDto, UpdateShiftTemplateDto } from '../dto/shift-template.dto';
import { AssignEmployeesDto } from '../dto/assign-employees.dto';
import { UsersRepository } from '../../users/repositories/users.repository';
import { OpeningHoursWeek, ShopOpeningHours } from '../entities/opening-hours.entity';
import { ShiftTemplate, ShiftTemplateWithDuration } from '../entities/shift-template.entity';
import {
  contains,
  durationMinutes,
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

  private durationOf(template: ShiftTemplate, day: ShopOpeningHours | undefined): number {
    // A slot whose day was later closed keeps its stored times; measure it
    // against itself so the grid still renders a length instead of failing.
    const opening = day
      ? openingWindow(day.open_time, day.close_time)
      : openingWindow(template.start_time, template.end_time);

    return durationMinutes(slotWindow(template.start_time, template.end_time, opening));
  }
}
