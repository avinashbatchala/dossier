import { addDays, AGENDA_DAYS, dayOf, isDay, monthDays, shiftMonth, type Day } from "@/lib/calendar-view";
import { workingHours } from "@/lib/google/availability";
import { loadCalendar } from "@/lib/google/calendar-data";

import { CalendarCard } from "./calendar-card";

/**
 * The calendar beside the dashboard's cards (E15-6): the month of `?date=`,
 * else this one, with the events in Google Calendar next to your interviews.
 * Google is asked on every visit, so the dashboard shows without waiting.
 */
export async function DashboardCalendar({ date, now }: { date: unknown; now: Date }) {
  const { timeZone } = await workingHours();
  const today = dayOf(now, timeZone);
  const start = isDay(date) ? date : today;
  const days = monthDays(start);
  // Through a week past the month's last day, for the agenda of any day picked.
  const calendar = await loadCalendar([days[0], addDays(days.at(-1)!, AGENDA_DAYS - 1)]);
  // This month opens on today, any other on its first day.
  const at = (day: Day) => (day.slice(0, 7) === today.slice(0, 7) ? "/" : `/?date=${day}`);
  return (
    <CalendarCard
      // A new month starts afresh, picking its first day or today.
      key={start}
      month={start}
      today={today}
      start={start}
      items={calendar.items}
      timeZone={calendar.timeZone}
      source={calendar.source}
      links={{ previous: at(shiftMonth(start, -1)), next: at(shiftMonth(start, 1)), today: "/" }}
    />
  );
}

/** Its place while Google answers. */
export function CalendarSkeleton() {
  return (
    <div role="status" className="h-[440px] rounded-panel bg-track">
      <span className="sr-only">Loading your calendar…</span>
    </div>
  );
}
