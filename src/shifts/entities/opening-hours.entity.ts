/**
 * One weekday of the shop's trading week. `weekday` is 0 = Sunday, matching
 * JavaScript's `Date.getDay()`.
 *
 * Times are bare wall-clock strings ('08:00:00'), not timestamps — a weekly
 * schedule recurs, so it has no date. They are read against `Shop.timezone`;
 * see `07-ShiftOpeningHours.sql`.
 *
 * `close_time` earlier than `open_time` means the day runs past midnight.
 * `'24:00:00'` is a valid close, meaning the end of the same day.
 */
export class ShopOpeningHours {
  shop_id!: number;
  weekday!: number;
  open_time!: string;
  close_time!: string;
  /** When true, `open_time`/`close_time` are retained but carry no meaning. */
  is_closed!: boolean;
}

/**
 * The whole week in one response. The timezone travels with it because a time
 * of day is unreadable without one, and a client that had to fetch it
 * separately could render the grid before it arrived.
 *
 * `days` always holds exactly 7 entries, ordered 0..6, whether or not the
 * owner has saved anything — an unset day comes back closed rather than
 * missing, so the client renders one shape instead of two.
 */
export class OpeningHoursWeek {
  timezone!: string;
  days!: ShopOpeningHours[];
}
