import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { dayOf, isDay, rangeTitle, shiftAnchor, visibleDays, type CalendarView, type Day } from "@/lib/calendar-view";
import { workingHours } from "@/lib/google/availability";
import { loadCalendar, type CalendarSource } from "@/lib/google/calendar-data";

import { CalendarToolbar } from "./calendar-toolbar";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";

export const metadata: Metadata = { title: "Calendar" };

const href = (view: CalendarView, day: Day) => `/calendar?view=${view}&date=${day}`;

/**
 * Your week or month (E15-6): the events in Google Calendar next to your
 * interviews, which open their application. `?view=week|month&date=` picks
 * what's on screen.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const view: CalendarView = params.view === "month" ? "month" : "week";
  const { timeZone } = await workingHours();
  const now = new Date();
  const today = dayOf(now, timeZone);
  const anchor = isDay(params.date) ? params.date : today;
  const days = visibleDays(view, anchor);
  const calendar = await loadCalendar(days);

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Your interviews${calendar.source.status === "google" ? " and the rest of your Google Calendar" : ""}, in your time zone (${calendar.timeZone}).`}
      />
      <CalendarToolbar
        view={view}
        title={rangeTitle(view, anchor)}
        links={{
          previous: href(view, shiftAnchor(view, anchor, -1)),
          next: href(view, shiftAnchor(view, anchor, 1)),
          today: href(view, today),
          week: href("week", view === "month" && anchor.slice(0, 7) !== today.slice(0, 7) ? anchor : today),
          month: href("month", anchor),
        }}
      />
      <SourceNotice source={calendar.source} />
      {view === "week" ? (
        <WeekView days={days} today={today} now={now} items={calendar.items} timeZone={calendar.timeZone} workStart={calendar.workStart} />
      ) : (
        <MonthView days={days} anchor={anchor} today={today} items={calendar.items} timeZone={calendar.timeZone} />
      )}
    </>
  );
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
    <div className="mx-10 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-card bg-card px-4 py-3 text-meta">
      <p className="text-muted">{text}</p>
      {source.status !== "failed" && (
        <Link href="/settings?section=google" className="inline-flex min-h-6 items-center font-medium underline underline-offset-2">
          Settings → Google
        </Link>
      )}
    </div>
  );
}
