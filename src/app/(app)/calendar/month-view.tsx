import Link from "next/link";

import { dayLabel, itemsOnDay, type CalendarItem, type Day } from "@/lib/calendar-view";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/dates";

import { ItemLink } from "./calendar-item";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Items a day shows before "+2 more". */
const SHOWN = 3;

/**
 * Six weeks around a month (E15-6): each day with its first few events, and
 * a link to its week for the rest. Days outside the month are dimmed.
 */
export function MonthView({ days, anchor, today, items, timeZone }: { days: Day[]; anchor: Day; today: Day; items: CalendarItem[]; timeZone: string }) {
  const month = anchor.slice(0, 7);
  return (
    <div className="mx-10 mb-16 overflow-hidden rounded-panel border border-line-card bg-card">
      <div aria-hidden="true" className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className="px-2 py-2 text-meta text-muted">
            {weekday}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const list = itemsOnDay(items, day, timeZone);
          const week = `/calendar?view=week&date=${day}`;
          return (
            <section
              key={day}
              aria-label={dayLabel(day)}
              className={cn("flex min-h-32 min-w-0 flex-col gap-1 border-line p-1.5", index % 7 !== 0 && "border-l", index < 35 && "border-b", day.slice(0, 7) !== month && "bg-paper/50")}
            >
              <Link
                href={week}
                aria-label={`Open the week of ${dayLabel(day)}`}
                className={cn(
                  "grid size-7 place-items-center self-start rounded-full font-serif text-[15px] no-underline hover:bg-hover",
                  day.slice(0, 7) !== month && "text-muted",
                  day === today && "bg-primary text-on-primary hover:bg-primary-hover hover:text-on-primary",
                )}
              >
                {Number(day.slice(8))}
              </Link>
              <ol className="flex min-w-0 flex-col gap-0.5">
                {list.slice(0, SHOWN).map((item) => (
                  <li key={item.id}>
                    <ItemLink item={item} className="flex min-h-6 items-center gap-1.5 px-1.5 text-xs">
                      {!item.allDay && <span className="shrink-0 tabular-nums opacity-80">{formatTime(item.start, timeZone)}</span>}{" "}
                      <span className="truncate font-medium">{item.title}</span>
                    </ItemLink>
                  </li>
                ))}
              </ol>
              {list.length > SHOWN && (
                <Link href={week} className="inline-flex min-h-6 items-center self-start px-1.5 text-xs text-muted hover:text-ink">
                  +{list.length - SHOWN} more
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
