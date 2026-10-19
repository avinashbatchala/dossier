// Dates as the app shows them: "27 Sep 2026", or "3 Oct" within the current year.

/** Day, short month ("Sep", as en-US has it; en-GB now says "Sept") and optionally the year. */
function format(date: Date, { year, timeZone }: { year: boolean; timeZone?: string }): string {
  const parts = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return [part("day"), part("month"), year ? part("year") : ""].filter(Boolean).join(" ");
}

/**
 * "15 Oct 2026" for a calendar date stored at UTC midnight, such as a
 * deadline, so it's the same day wherever it's shown.
 */
export function formatCalendarDate(date: Date): string {
  return format(date, { year: true, timeZone: "UTC" });
}

/**
 * "27 Sep 2026" for a moment, such as when something was created, in the
 * server's time zone (the TZ variable). Call it on the server, so the page
 * shows the same day as it was rendered with.
 */
export function formatDate(date: Date): string {
  return format(date, { year: true });
}

/** "3 Oct" when it's in the same year as `now`, otherwise "3 Oct 2025"; in the server's time zone. */
export function formatShortDate(date: Date, now = new Date()): string {
  return format(date, { year: date.getFullYear() !== now.getFullYear() });
}

/** "3 Oct" for a calendar date (UTC midnight) in the same year as `now`, otherwise "3 Oct 2027". */
export function formatShortCalendarDate(date: Date, now = new Date()): string {
  return format(date, { year: date.getUTCFullYear() !== now.getFullYear(), timeZone: "UTC" });
}

// ─── Moments in the user's time zone ─────────────────────────────────────────
// For times the user picked, such as an interview (E9-9): shown in the time
// zone the browser reports (see src/lib/time-zone.ts), the server's when not given.

/** The calendar day a moment falls on in a time zone, as UTC midnight of that day. */
function dayIn(date: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

/** Calendar days from `from` to `to` in a time zone: 0 on the same day, 1 the next day, -1 the day before. */
export function daysBetween(from: Date, to: Date, timeZone?: string): number {
  return Math.round((dayIn(to, timeZone) - dayIn(from, timeZone)) / 86_400_000);
}

/**
 * "2026-10-22T14:00:00+02:00": the moment as a wall clock in `timeZone`,
 * with that zone's offset then, for prompts that read times in the user's zone.
 */
export function isoInZone(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  // "GMT+02:00", or "GMT" for UTC itself.
  const offset = parts.timeZoneName.replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** "14:00" in a time zone. */
export function formatTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(date);
}

/** "Thu 8 Oct" in a time zone, with the year when it isn't the same as `now`'s. */
export function formatDay(date: Date, timeZone?: string, now = new Date()): string {
  const year = new Date(dayIn(date, timeZone)).getUTCFullYear() !== new Date(dayIn(now, timeZone)).getUTCFullYear();
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date);
  return `${weekday} ${format(date, { year, timeZone })}`;
}

/** "Thu 8 Oct, 14:00" in a time zone, with the year when it isn't the same as `now`'s. */
export function formatDateTime(date: Date, timeZone?: string, now = new Date()): string {
  return `${formatDay(date, timeZone, now)}, ${formatTime(date, timeZone)}`;
}
