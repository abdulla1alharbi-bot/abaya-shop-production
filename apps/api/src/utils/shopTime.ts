/**
 * Timezone-aware month boundaries.
 *
 * The server runs in UTC but the shop operates in its own timezone (Asia/Dubai
 * by default). Computing a month range with the server's local `new Date(y, m, d)`
 * therefore slices the month on UTC boundaries, so production/adjustment rows made
 * in the late-evening (shop time) near a month edge fall into the wrong month.
 * These helpers slice the month on the SHOP's wall-clock boundaries instead.
 */

const DEFAULT_TIMEZONE = "Asia/Dubai";

/** UTC offset (ms) of `timeZone` at the given instant. Handles DST-aware zones. */
function tzOffsetMs(timeZone: string, atUtc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const p of dtf.formatToParts(atUtc)) {
    if (p.type in parts) {
      parts[p.type as keyof typeof parts] = Number(p.value);
    }
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour === 24 ? 0 : parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - atUtc.getTime();
}

/** The UTC instant for a wall-clock time in `timeZone`. */
function zonedWallClockToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const guessMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offset = tzOffsetMs(timeZone, new Date(guessMs));
  return new Date(guessMs - offset);
}

/**
 * Returns the UTC instants bounding `month`/`year` as seen in `timeZone`:
 * `from` = first day 00:00:00.000 shop-time, `to` = last millisecond of the month.
 */
export function monthRangeUtc(
  year: number,
  month: number,
  timeZone: string = DEFAULT_TIMEZONE,
): { from: Date; to: Date } {
  const from = zonedWallClockToUtc(timeZone, year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextStart = zonedWallClockToUtc(timeZone, nextYear, nextMonth, 1);
  const to = new Date(nextStart.getTime() - 1);
  return { from, to };
}
