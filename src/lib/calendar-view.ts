import { zonedTime } from "@/lib/google/slots";

// The Calendar screen's dates (E15-6): which days a week or month shows, and
// where each event goes in them, in the user's time zone. Days are
// "2026-10-19" strings; weeks start on Monday. Pure, so it's tested alone.

export const CALENDAR_VIEWS = ["week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** A day as "2026-10-19". */
export type Day = string;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a string is a day, e.g. from the address bar. */
export const isDay = (value: unknown): value is Day => typeof value === "string" && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const parts = (day: Day) => {
  const [, year, month, date] = DAY.exec(day)!;
  return { year: +year, month: +month, date: +date };
};
const toDay = (utc: Date): Day => utc.toISOString().slice(0, 10);

/** The day a moment falls on in a time zone. */
export function dayOf(moment: Date, timeZone: string): Day {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(moment).map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(day: Day, count: number): Day {
  const { year, month, date } = parts(day);
  return toDay(new Date(Date.UTC(year, month - 1, date + count)));
}

/** 1 = Monday … 7 = Sunday. */
export const weekday = (day: Day) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

export const startOfWeek = (day: Day) => addDays(day, 1 - weekday(day));

export const startOfMonth = (day: Day) => `${day.slice(0, 7)}-01`;

/** The days a view shows around `anchor`: its week, or six whole weeks from the Monday on or before the 1st. */
export function visibleDays(view: CalendarView, anchor: Day): Day[] {
  const first = view === "week" ? startOfWeek(anchor) : startOfWeek(startOfMonth(anchor));
  return Array.from({ length: view === "week" ? 7 : 42 }, (_, index) => addDays(first, index));
}

/** The day the previous or next week or month starts on. */
export function shiftAnchor(view: CalendarView, anchor: Day, by: 1 | -1): Day {
  if (view === "week") return addDays(startOfWeek(anchor), 7 * by);
  const { year, month } = parts(anchor);
  return toDay(new Date(Date.UTC(year, month - 1 + by, 1)));
}

/** The moment a day starts in a time zone. */
export function startOfDay(day: Day, timeZone: string): Date {
  const { year, month, date } = parts(day);
  return zonedTime(year, month, date, 0, 0, timeZone);
}

/** "19–25 Oct 2026", "28 Sept – 4 Oct 2026" or "October 2026". */
export function rangeTitle(view: CalendarView, anchor: Day): string {
  const at = (day: Day, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(`${day}T00:00:00Z`));
  if (view === "month") return at(anchor, { month: "long", year: "numeric" });
  const days = visibleDays("week", anchor);
  const [first, last] = [days[0], days[6]];
  if (first.slice(0, 7) === last.slice(0, 7)) return `${parts(first).date}–${at(last, { day: "numeric", month: "short", year: "numeric" })}`;
  if (first.slice(0, 4) === last.slice(0, 4)) return `${at(first, { day: "numeric", month: "short" })} – ${at(last, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${at(first, { day: "numeric", month: "short", year: "numeric" })} – ${at(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** "Monday 19 October", for a day's label. */
export const dayLabel = (day: Day) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T00:00:00Z`));

/** Something on the calendar: an event from Google, or an interview. */
export type CalendarItem = {
  id: string;
  title: string;
  kind: "interview" | "event";
  /** Where it opens: the application, or the event in Google Calendar. */
  href: string | null;
  external: boolean;
} & ({ allDay: false; start: Date; end: Date } | { allDay: true; startDay: Day; endDay: Day });

export type TimedItem = Extract<CalendarItem, { allDay: false }>;
export type AllDayItem = Extract<CalendarItem, { allDay: true }>;

/** Whether an all-day item covers a day; its end day is the one after it. */
export const coversDay = (item: AllDayItem, day: Day) => item.startDay <= day && day < item.endDay;

/** A timed item's part on one day, in minutes from the day's start, and its column among the ones it overlaps. */
export type Placed = { item: TimedItem; top: number; height: number; column: number; columns: number; startsBefore: boolean; endsAfter: boolean };

/**
 * Where a day's timed items go in the week grid: their part of the day (an
 * item over midnight shows on both days), side by side where they overlap.
 */
export function placeDay(items: readonly TimedItem[], day: Day, timeZone: string): Placed[] {
  const from = startOfDay(day, timeZone).getTime();
  const to = startOfDay(addDays(day, 1), timeZone).getTime();
  const parts = items
    .filter((item) => item.start.getTime() < to && item.end.getTime() > from)
    .map((item) => {
      const start = Math.max(item.start.getTime(), from);
      const end = Math.max(Math.min(item.end.getTime(), to), start);
      return { item, start, end, startsBefore: item.start.getTime() < from, endsAfter: item.end.getTime() > to };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: Placed[] = [];
  // Groups of items that overlap each other, directly or through another one.
  let group: (Placed & { end: number })[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    const columns = Math.max(1, ...group.map((entry) => entry.column + 1));
    for (const entry of group) placed.push({ item: entry.item, top: entry.top, height: entry.height, column: entry.column, columns, startsBefore: entry.startsBefore, endsAfter: entry.endsAfter });
    group = [];
  };
  for (const part of parts) {
    if (part.start >= groupEnd) {
      close();
      groupEnd = -Infinity;
    }
    // The first column whose last item has ended.
    let column = 0;
    while (group.some((entry) => entry.column === column && entry.end > part.start)) column++;
    group.push({
      item: part.item,
      top: (part.start - from) / 60_000,
      height: (part.end - part.start) / 60_000,
      column,
      columns: 1,
      startsBefore: part.startsBefore,
      endsAfter: part.endsAfter,
      end: part.end,
    });
    groupEnd = Math.max(groupEnd, part.end);
  }
  close();
  return placed;
}

/** A day's items for the month grid: all-day ones first, then by start. */
export function itemsOnDay(items: readonly CalendarItem[], day: Day, timeZone: string): CalendarItem[] {
  const from = startOfDay(day, timeZone).getTime();
  const to = startOfDay(addDays(day, 1), timeZone).getTime();
  return items
    .filter((item) => (item.allDay ? coversDay(item, day) : item.start.getTime() < to && item.end.getTime() > from))
    .sort((a, b) => (a.allDay === b.allDay ? (a.allDay || b.allDay ? 0 : a.start.getTime() - b.start.getTime()) : a.allDay ? -1 : 1));
}
