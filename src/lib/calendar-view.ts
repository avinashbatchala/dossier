import { zonedTime } from "@/lib/google/slots";

// The dashboard calendar's dates (E15-6): which days a month shows, and what
// the agenda lists from the day picked, in the user's time zone. Days are
// "2026-10-19" strings; weeks start on Monday. Pure, so it's tested alone.

/** A day as "2026-10-19". */
export type Day = string;

/** How many days the agenda lists, from the day picked. */
export const AGENDA_DAYS = 7;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a string is a day, e.g. from the address bar. */
export const isDay = (value: unknown): value is Day => typeof value === "string" && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const parts = (day: Day) => {
  const [, year, month, date] = DAY.exec(day)!;
  return { year: +year, month: +month, date: +date };
};
const toDay = (utc: Date): Day => utc.toISOString().slice(0, 10);
const format = (day: Day, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(`${day}T00:00:00Z`));

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

/** The first day of the month before or after. */
export function shiftMonth(anchor: Day, by: 1 | -1): Day {
  const { year, month } = parts(anchor);
  return toDay(new Date(Date.UTC(year, month - 1 + by, 1)));
}

/** The whole weeks a month touches, Monday to Sunday: four to six of them. */
export function monthDays(anchor: Day): Day[] {
  const first = startOfWeek(startOfMonth(anchor));
  const last = addDays(startOfWeek(addDays(shiftMonth(anchor, 1), -1)), 6);
  const days = [first];
  while (days.at(-1) !== last) days.push(addDays(days.at(-1)!, 1));
  return days;
}

/** The moment a day starts in a time zone. */
export function startOfDay(day: Day, timeZone: string): Date {
  const { year, month, date } = parts(day);
  return zonedTime(year, month, date, 0, 0, timeZone);
}

/** "October 2026". */
export const monthTitle = (anchor: Day) => format(anchor, { month: "long", year: "numeric" });

/** "Monday 19 October", for a day's label. */
export const dayLabel = (day: Day) => format(day, { weekday: "long", day: "numeric", month: "long" });

/** "Mon 19 Oct", for the agenda. */
export const shortDayLabel = (day: Day) => format(day, { weekday: "short", day: "numeric", month: "short" });

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

/** A day's items: all-day ones first, then by start. One over midnight is on both days. */
export function itemsOnDay(items: readonly CalendarItem[], day: Day, timeZone: string): CalendarItem[] {
  const from = startOfDay(day, timeZone).getTime();
  const to = startOfDay(addDays(day, 1), timeZone).getTime();
  return items
    .filter((item) => (item.allDay ? coversDay(item, day) : item.start.getTime() < to && item.end.getTime() > from))
    .sort((a, b) => (a.allDay === b.allDay ? (a.allDay || b.allDay ? 0 : a.start.getTime() - b.start.getTime()) : a.allDay ? -1 : 1));
}

/** The agenda: the days from `from` that have something on them, each with its items. */
export function agenda(items: readonly CalendarItem[], from: Day, timeZone: string, count = AGENDA_DAYS): { day: Day; items: CalendarItem[] }[] {
  return Array.from({ length: count }, (_, index) => addDays(from, index))
    .map((day) => ({ day, items: itemsOnDay(items, day, timeZone) }))
    .filter((entry) => entry.items.length > 0);
}
