import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ShiftsRepository } from '../repositories/shifts.repository';
import { UpdateOpeningHoursDto } from '../dto/update-opening-hours.dto';
import { OpeningHoursWeek, ShopOpeningHours } from '../entities/opening-hours.entity';
import { RequestUser } from '../../common/interfaces/request-user.interface';

/** Sunday..Saturday, matching JavaScript's `Date.getDay()`. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

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
}
