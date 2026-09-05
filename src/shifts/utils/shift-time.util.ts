/**
 * The one place the midnight rule is decided.
 *
 * A weekly schedule stores bare wall-clock times, so a shop trading 18:00 to
 * 02:00 has windows that read backwards as plain strings — `'02:00' < '18:00'`
 * says the day ends before it starts. Comparing those strings directly is the
 * bug this module exists to prevent.
 *
 * Every window is converted to **minutes from midnight of the opening day**,
 * which turns a crossing window into an ordinary ascending range and reduces
 * "does it fit" and "do these collide" to number comparisons. Containment and
 * overlap therefore share one definition of when a time happens; if each grew
 * its own midnight handling they would eventually disagree, and a slot that is
 * inside opening hours but overlaps itself is a hard bug to see.
 */

export const MINUTES_PER_DAY = 24 * 60;

/**
 * A half-open range `[start, end)` in minutes from midnight of the day the
 * window opened. `end` may exceed 1440, which is exactly how "past midnight"
 * is represented.
 *
 * Half-open matters: it makes a shift ending at 16:00 and the next starting at
 * 16:00 adjacent rather than overlapping, which is what a handover is.
 */
export interface TimeWindow {
  start: number;
  end: number;
}

/**
 * `'08:00'` or `'08:00:00'` to minutes. `'24:00'` yields 1440 — Postgres
 * `TIME` accepts it, and it is how "end of day" is written without wrapping
 * to 0, which would read as the *start* of the day and empty the window.
 */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Minutes back to `'HH:MM'`, wrapping past-midnight values into the next day —
 * so a Friday window ending at 1560 reads `'02:00'`.
 *
 * Landing exactly on a day boundary is the exception: a window that closes at
 * the end of the day renders `'24:00'`, not `'00:00'`. Wrapping it would put
 * the close at the *start* of the day and make "08:00 to 00:00" look like an
 * empty or backwards window in the message the owner reads.
 */
export function toTimeString(minutes: number): string {
  if (minutes > 0 && minutes % MINUTES_PER_DAY === 0) return '24:00';

  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  return `${String(hours).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * The shop's trading window for one weekday. A close at or before the open is
 * read as the following day, so 18:00 to 02:00 becomes 1080 to 1560 — eight
 * hours long, in order, and directly comparable.
 */
export function openingWindow(openTime: string, closeTime: string): TimeWindow {
  const start = toMinutes(openTime);
  let end = toMinutes(closeTime);

  if (end <= start) end += MINUTES_PER_DAY;

  return { start, end };
}

/**
 * A shift window, positioned **relative to the opening window** rather than to
 * midnight. This is the subtle part.
 *
 * On a Friday trading 18:00 to 02:00, a shift written 00:00 to 02:00 belongs to
 * the small hours at the *end* of that trading day, not to the morning fourteen
 * hours before it opened. Any start earlier than the opening time is therefore
 * pushed a day forward before the end is resolved, so the shift lands inside
 * the day it was written for.
 */
export function slotWindow(startTime: string, endTime: string, opening: TimeWindow): TimeWindow {
  let start = toMinutes(startTime);

  if (start < opening.start) start += MINUTES_PER_DAY;

  let end = toMinutes(endTime);

  // Resolve the end against the already-positioned start, not against
  // midnight, or a shift running 22:00 -> 02:00 would come back inverted.
  while (end <= start) end += MINUTES_PER_DAY;

  return { start, end };
}

/** Whether `inner` lies entirely within `outer`. Equal edges are inside. */
export function contains(outer: TimeWindow, inner: TimeWindow): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/**
 * Whether two windows share any time. Half-open, so windows that merely touch
 * — one ending exactly where the next begins — do not overlap.
 */
export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.start < b.end && b.start < a.end;
}

export function durationMinutes(window: TimeWindow): number {
  return window.end - window.start;
}
