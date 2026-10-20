import "server-only";

import { addDays, startOfDay, type CalendarItem, type Day } from "@/lib/calendar-view";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { googleConnection } from "./account";
import { pullInterviewEvents, workingHours } from "./availability";
import { listEvents, type CalendarEvent } from "./calendar";
import { GoogleError } from "./errors";

// What the dashboard's calendar shows (E15-6): the events in the calendar
// chosen in Settings → Google, with the interviews Dossier added linked to
// their application, and the interviews that aren't in Google. Events are
// read for the days on screen and never kept.

export type CalendarSource =
  | { status: "google" }
  | { status: "not-connected" }
  | { status: "no-permission" }
  | { status: "failed"; message: string };

export type CalendarData = {
  items: CalendarItem[];
  timeZone: string;
  source: CalendarSource;
};

const interviewTitle = (application: { company: string; role: string; title: string }) =>
  `Interview · ${[application.role || application.title, application.company].filter(Boolean).join(" · ") || "application"}`;

export async function loadCalendar(days: readonly Day[]): Promise<CalendarData> {
  const [hours, connection, settings] = await Promise.all([workingHours(), googleConnection(), loadSettings()]);
  const { timeZone } = hours;
  const from = startOfDay(days[0], timeZone);
  const to = startOfDay(addDays(days[days.length - 1], 1), timeZone);

  let source: CalendarSource;
  let events: CalendarEvent[] = [];
  if (connection.status !== "connected") source = { status: "not-connected" };
  else if (!connection.canUseCalendar) source = { status: "no-permission" };
  else {
    try {
      // Interviews moved or deleted in Google first, so both sides agree.
      await pullInterviewEvents({ signal: AbortSignal.timeout(5_000) }).catch(() => {});
      events = await listEvents(settings.calendarId, from, to, AbortSignal.timeout(10_000));
      source = { status: "google" };
    } catch (error) {
      if (!(error instanceof GoogleError)) throw error;
      source = { status: "failed", message: error.message };
    }
  }

  const interviews = await prisma.application.findMany({
    where: { archivedAt: null, nextInterviewAt: { gte: from, lt: to } },
    select: { id: true, company: true, role: true, title: true, nextInterviewAt: true, interviewEventId: true },
  });
  // Events tied to an application that still exists, by the property Dossier set or the id it kept.
  const tagged = [...new Set(events.map((event) => event.applicationId).filter((id): id is string => Boolean(id)))];
  const existing = new Set((await prisma.application.findMany({ where: { id: { in: tagged } }, select: { id: true } })).map(({ id }) => id));
  const byEvent = new Map(interviews.filter((application) => application.interviewEventId).map((application) => [application.interviewEventId!, application.id]));

  const items: CalendarItem[] = [];
  const shown = new Set<string>();
  for (const event of events) {
    const applicationId = (event.applicationId && existing.has(event.applicationId) ? event.applicationId : null) ?? byEvent.get(event.id) ?? null;
    if (applicationId) shown.add(applicationId);
    const base = {
      id: event.id,
      title: event.title || "(No title)",
      kind: applicationId ? ("interview" as const) : ("event" as const),
      href: applicationId ? `/applications/${applicationId}` : event.link || null,
      external: !applicationId && Boolean(event.link),
    };
    if (event.start && event.end) items.push({ ...base, allDay: false, start: event.start, end: event.end });
    else if (event.startDate && event.endDate) items.push({ ...base, allDay: true, startDay: event.startDate, endDay: event.endDate });
  }
  for (const application of interviews) {
    if (shown.has(application.id)) continue;
    const start = application.nextInterviewAt!;
    items.push({
      id: `interview-${application.id}`,
      title: interviewTitle(application),
      kind: "interview",
      href: `/applications/${application.id}`,
      external: false,
      allDay: false,
      start,
      end: new Date(start.getTime() + hours.slotMinutes * 60_000),
    });
  }
  return { items, timeZone, source };
}
