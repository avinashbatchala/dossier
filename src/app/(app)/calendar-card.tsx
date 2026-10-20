"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type KeyboardEvent } from "react";

import { buttonClassName } from "@/components/ui/button";
import { addDays, AGENDA_DAYS, agenda, dayLabel, itemsOnDay, monthDays, monthTitle, shortDayLabel, startOfMonth, type CalendarItem, type Day } from "@/lib/calendar-view";
import { cn } from "@/lib/cn";
import type { CalendarSource } from "@/lib/google/calendar-data";

import { itemDot, ItemLink, itemTime } from "./calendar-item";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
/** The arrow keys move a day or a week through the month. */
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The dashboard's calendar (E15-6): a month with marks on the days that have
 * something on, and below it what's on from the day picked, today at first,
 * for a week. Interviews open their application; other events open in
 * Google Calendar. Picking a day stays on the page; another month loads.
 */
export function CalendarCard({
  month,
  today,
  start,
  items,
  timeZone,
  source,
  links,
}: {
  /** The month on show, as a day in it. */
  month: Day;
  today: Day;
  /** The day picked at first. */
  start: Day;
  /** Everything from the month's first week through a week past its last. */
  items: CalendarItem[];
  timeZone: string;
  source: CalendarSource;
  links: { previous: string; next: string; today: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, pick] = useState(start);
  const grid = useRef<HTMLDivElement>(null);
  const days = monthDays(month);
  const entries = agenda(items, picked, timeZone);

  // Another month, without scrolling the dashboard; dimmed until it's in.
  const load = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  const onNavigate = (href: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    load(href);
  };

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const step = STEPS[event.key];
    const from = (event.target as HTMLElement).dataset.day;
    const next = step && from ? days[days.indexOf(from) + step] : undefined;
    if (!next) return;
    event.preventDefault();
    pick(next);
    grid.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
  }

  return (
    <section
      aria-labelledby="calendar-heading"
      aria-busy={pending || undefined}
      className={cn("flex flex-col gap-4 rounded-panel border border-line-card bg-card px-6 pt-[26px] pb-5", pending && "opacity-60 motion-safe:transition-opacity")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="calendar-heading" className="text-[15px] font-medium">
          Calendar
        </h2>
        {picked !== today && (
          <Link
            href={links.today}
            onNavigate={(event) => {
              // Today's month is already on show: no need to load it.
              if (month.slice(0, 7) !== today.slice(0, 7)) return onNavigate(links.today)(event);
              event.preventDefault();
              pick(today);
            }}
            className="text-meta text-muted underline underline-offset-3 hover:text-ink"
          >
            Today
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <Link href={links.previous} onNavigate={onNavigate(links.previous)} aria-label="Previous month" title="Previous month" className={buttonClassName("text", "sm", "px-1.5!")}>
            <ChevronLeft size={16} aria-hidden="true" />
          </Link>
          <p className="font-serif text-lg">{monthTitle(month)}</p>
          <Link href={links.next} onNavigate={onNavigate(links.next)} aria-label="Next month" title="Next month" className={buttonClassName("text", "sm", "px-1.5!")}>
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div aria-hidden="true" className="grid grid-cols-7 text-center text-xs text-muted">
          {WEEKDAYS.map((weekday, index) => (
            <span key={index} className="py-1">
              {weekday}
            </span>
          ))}
        </div>
        {/* One day takes Tab, the arrow keys move between them. */}
        <div ref={grid} role="group" aria-label={monthTitle(month)} onKeyDown={move} className="grid grid-cols-7 gap-y-0.5">
          {days.map((day) => {
            const list = itemsOnDay(items, day, timeZone);
            const interviews = list.filter((item) => item.kind === "interview").length;
            const others = list.length - interviews;
            const isPicked = day === picked;
            return (
              <button
                key={day}
                type="button"
                data-day={day}
                tabIndex={day === (days.includes(picked) ? picked : startOfMonth(month)) ? 0 : -1}
                aria-pressed={isPicked}
                aria-current={day === today ? "date" : undefined}
                aria-label={[dayLabel(day), interviews > 0 && plural(interviews, "interview", "interviews"), others > 0 && plural(others, "event", "events")].filter(Boolean).join(", ")}
                onClick={() => pick(day)}
                className="flex flex-col items-center gap-0.5 rounded-control py-1 hover:bg-hover"
              >
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full font-serif text-[15px] tabular-nums",
                    day.slice(0, 7) !== month.slice(0, 7) && "text-muted",
                    day === today ? "bg-primary text-on-primary" : isPicked && "ring-1 ring-ink",
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {/* What's on, which the label says in words: an interview, other events. */}
                <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                  {interviews > 0 && <span className="size-1.5 rounded-full bg-primary" />}
                  {others > 0 && <span className="size-1.5 rounded-full bg-faint" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-line pt-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted">
            {picked === today ? `Nothing in the next ${AGENDA_DAYS} days.` : `Nothing from ${shortDayLabel(picked)} to ${shortDayLabel(addDays(picked, AGENDA_DAYS - 1))}.`}
          </p>
        ) : (
          entries.map(({ day, items: onDay }) => (
            <div key={day} className="flex flex-col gap-1.5">
              <h3 className="text-meta text-muted">{agendaDay(day, today)}</h3>
              <ul className="-mx-2.5">
                {onDay.map((item) => (
                  <li key={item.id}>
                    <ItemLink item={item} className="flex items-start gap-3 px-2.5 py-1.5 text-control">
                      <span aria-hidden="true" className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", itemDot(item))} />
                      <span className="w-[84px] shrink-0 text-muted tabular-nums">{itemTime(item, timeZone)}</span>{" "}
                      <span className={cn("min-w-0 break-words", item.kind === "interview" && "font-medium")}>{item.title}</span>
                    </ItemLink>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3 text-meta text-muted">
        <SourceNotice source={source} />
        <p>In your time zone ({timeZone}).</p>
      </div>
    </section>
  );
}

/** "Today · Tue 20 Oct", "Tomorrow · Wed 21 Oct" or "Thu 22 Oct". */
function agendaDay(day: Day, today: Day) {
  const label = shortDayLabel(day);
  if (day === today) return `Today · ${label}`;
  if (day === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

/** Why only interviews show, when Google Calendar isn't there. */
function SourceNotice({ source }: { source: CalendarSource }) {
  if (source.status === "google") return null;
  const text =
    source.status === "failed"
      ? `Your Google Calendar didn't load: ${source.message}`
      : source.status === "no-permission"
        ? "Dossier may not use your calendar yet. Allow it in Settings → Google to see your other events here."
        : "Connect Google Calendar in Settings → Google to see your other events here, and keep interviews in step with it.";
  return (
    <p>
      {text}
      {source.status !== "failed" && (
        <>
          {" "}
          <Link href="/settings?section=google" className="inline-flex min-h-6 items-center font-medium text-ink underline underline-offset-2">
            Settings → Google
          </Link>
        </>
      )}
    </p>
  );
}
