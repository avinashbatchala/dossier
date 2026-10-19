// Free interview slots from the calendar's busy times and the working hours
// in Settings → Google (E15-5). Pure, so it's tested without Google.

export type Interval = { start: Date; end: Date };

export type WorkingHours = {
  /** 1 = Monday … 7 = Sunday. */
  days: readonly number[];
  /** "09:00" */
  start: string;
  end: string;
  timeZone: string;
  slotMinutes: number;
  bufferMinutes: number;
};

const MINUTE = 60_000;

/** The parts of `date` as a wall clock in `timeZone`. */
function wallClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second, weekday };
}

/** The instant a wall-clock time in `timeZone` is, DST included. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Twice, so a guess on the other side of a DST change settles.
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const clock = wallClock(new Date(instant), timeZone);
    const offset = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - instant;
    instant = guess - offset;
  }
  return new Date(instant);
}

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Free slots from `from` for `days` days: within working hours, clear of
 * every busy interval by the buffer, on a half-hour grid, starting at least
 * `noticeHours` from now. At most `perDay` a day and `max` in all, spread
 * over different days first.
 */
export function freeSlots(
  busy: readonly Interval[],
  hours: WorkingHours,
  { from, days = 10, noticeHours = 24, perDay = 3, max = 6, stepMinutes = 30 }: { from: Date; days?: number; noticeHours?: number; perDay?: number; max?: number; stepMinutes?: number },
): Interval[] {
  const earliest = from.getTime() + noticeHours * 60 * MINUTE;
  const length = hours.slotMinutes * MINUTE;
  const buffer = hours.bufferMinutes * MINUTE;
  const startMinute = minutesOf(hours.start);
  const endMinute = minutesOf(hours.end);
  const byDay: Interval[][] = [];

  const today = wallClock(from, hours.timeZone);
  for (let offset = 0; offset < days; offset++) {
    // Noon UTC on the day, so stepping by days never lands on the wrong date.
    const noon = new Date(Date.UTC(today.year, today.month - 1, today.day + offset, 12));
    const { weekday } = wallClock(noon, "UTC");
    if (!hours.days.includes(weekday)) continue;
    const [year, month, day] = [noon.getUTCFullYear(), noon.getUTCMonth() + 1, noon.getUTCDate()];
    const daySlots: Interval[] = [];
    for (let minute = startMinute; minute + hours.slotMinutes <= endMinute; minute += stepMinutes) {
      const start = zonedTime(year, month, day, Math.floor(minute / 60), minute % 60, hours.timeZone);
      const end = new Date(start.getTime() + length);
      if (start.getTime() < earliest) continue;
      const clash = busy.some((interval) => start.getTime() < interval.end.getTime() + buffer && end.getTime() > interval.start.getTime() - buffer);
      const crowded = daySlots.some((slot) => start.getTime() < slot.end.getTime() + Math.max(buffer, 60 * MINUTE));
      if (!clash && !crowded) daySlots.push({ start, end });
      if (daySlots.length >= perDay) break;
    }
    if (daySlots.length > 0) byDay.push(daySlots);
  }

  // One per day first, then a second per day, and so on.
  const picked: Interval[] = [];
  for (let round = 0; picked.length < max && byDay.some((slots) => slots.length > round); round++) {
    for (const slots of byDay) if (slots[round] && picked.length < max) picked.push(slots[round]);
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** "Tue 21 Oct, 10:00–10:45" in `timeZone`. */
export function formatSlot({ start, end }: Interval, timeZone: string, locale = "en-GB"): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(start);
  const time = (date: Date) => new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${day}, ${time(start)}–${time(end)}`;
}
