import { coversDay, dayLabel, placeDay, startOfDay, type AllDayItem, type CalendarItem, type Day, type TimedItem } from "@/lib/calendar-view";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/dates";

import { ItemLink, itemTime } from "./calendar-item";
import { WeekScroller } from "./week-scroller";

/** Pixels per hour in the grid: half an hour is 24px, the smallest target allowed. */
const HOUR = 48;
const MIN_HEIGHT = 24;
const COLUMNS = "grid grid-cols-[56px_repeat(7,minmax(0,1fr))]";

const weekdayShort = (day: Day) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(`${day}T00:00:00Z`));

/**
 * Seven days with an hour grid (E15-6): all-day events in a row above it,
 * the others placed by time, side by side where they overlap. Opens at the
 * start of the working day.
 */
export function WeekView({ days, today, now, items, timeZone, workStart }: { days: Day[]; today: Day; now: Date; items: CalendarItem[]; timeZone: string; workStart: string }) {
  const timed = items.filter((item): item is TimedItem => !item.allDay);
  const allDay = items.filter((item): item is AllDayItem => item.allDay);
  const withAllDay = days.some((day) => allDay.some((item) => coversDay(item, day)));
  const [hour, minute] = workStart.split(":").map(Number);
  // The current time, on today's column.
  const nowMinutes = days.includes(today) ? (now.getTime() - startOfDay(today, timeZone).getTime()) / 60_000 : null;

  return (
    <div className="mx-10 mb-16 overflow-hidden rounded-panel border border-line-card bg-card">
      <div aria-hidden="true" className={cn(COLUMNS, "border-b border-line")}>
        <div />
        {days.map((day) => (
          <div key={day} className="flex items-baseline justify-center gap-1.5 border-l border-line px-2 py-2.5">
            <span className="text-meta text-muted">{weekdayShort(day)}</span>
            <span className={cn("grid size-7 place-items-center rounded-full font-serif text-lg", day === today && "bg-primary text-on-primary")}>{Number(day.slice(8))}</span>
          </div>
        ))}
      </div>

      {withAllDay && (
        <div className={cn(COLUMNS, "border-b border-line")}>
          <div aria-hidden="true" className="px-2 py-2 text-right text-xs text-muted">
            All day
          </div>
          {days.map((day) => (
            <ol key={day} aria-label={`${dayLabel(day)}, all day`} className="flex min-w-0 flex-col gap-1 border-l border-line p-1">
              {allDay
                .filter((item) => coversDay(item, day))
                .map((item) => (
                  <li key={item.id}>
                    <ItemLink item={item} className="flex min-h-6 items-center px-1.5 text-xs font-medium">
                      <span className="truncate">{item.title}</span>
                    </ItemLink>
                  </li>
                ))}
            </ol>
          ))}
        </div>
      )}

      <WeekScroller top={Math.max(0, (hour + minute / 60) * HOUR - 8)}>
        <div className={COLUMNS} style={{ height: 24 * HOUR }}>
          <div aria-hidden="true" className="relative">
            {Array.from({ length: 23 }, (_, index) => (
              <span key={index} className="absolute right-2 -translate-y-1/2 text-xs text-muted tabular-nums" style={{ top: (index + 1) * HOUR }}>
                {String(index + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day) => (
            <section
              key={day}
              aria-label={dayLabel(day)}
              className={cn("relative min-w-0 border-l border-line", day === today && "bg-hover")}
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line) 0 1px, transparent 1px ${HOUR}px)` }}
            >
              <ol>
                {placeDay(timed, day, timeZone).map(({ item, top, height, column, columns, startsBefore }) => {
                  const pixels = Math.max((height * HOUR) / 60, MIN_HEIGHT);
                  return (
                    <li
                      key={item.id}
                      className="absolute px-0.5 py-px"
                      style={{ top: (top * HOUR) / 60, height: pixels, left: `${(column / columns) * 100}%`, width: `${100 / columns}%` }}
                    >
                      <ItemLink item={item} className={cn("h-full px-1.5 text-xs leading-tight", pixels >= 40 ? "py-1" : "flex items-center gap-1.5")}>
                        <span className={cn("tabular-nums", pixels >= 40 ? "block opacity-80" : "shrink-0")}>
                          {/* On one line, only where it starts, so the title has room. */}
                          {startsBefore ? `…${formatTime(item.end, timeZone)}` : pixels >= 40 ? itemTime(item, timeZone) : formatTime(item.start, timeZone)}
                        </span>{" "}
                        <span className={cn("font-medium", pixels >= 40 ? "line-clamp-3" : "truncate")}>{item.title}</span>
                      </ItemLink>
                    </li>
                  );
                })}
              </ol>
              {day === today && nowMinutes !== null && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-error" style={{ top: (nowMinutes * HOUR) / 60 }} />
              )}
            </section>
          ))}
        </div>
      </WeekScroller>
    </div>
  );
}

