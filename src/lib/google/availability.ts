import "server-only";

import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { googleConnection } from "./account";
import { busyTimes, createEvent, deleteEvent, getEvent, moveEvent } from "./calendar";
import { GoogleError } from "./errors";
import { freeSlots, type Interval, type WorkingHours } from "./slots";

// The calendar side (E15-5): free times to offer an employer, and agreed
// interviews added to the calendar and the dashboard.

/** The working hours in Settings → Google, in the saved time zone or else the browser's. */
export async function workingHours(): Promise<WorkingHours> {
  const settings = await loadSettings();
  const timeZone = settings.workTimeZone ?? (await lastKnownTimeZone());
  return {
    days: settings.workDays,
    start: settings.workStart,
    end: settings.workEnd,
    timeZone,
    slotMinutes: settings.slotMinutes,
    bufferMinutes: settings.bufferMinutes,
  };
}

/** Free times over the next two weeks; empty while the calendar isn't in use. */
export async function proposeSlots(now = new Date()): Promise<{ slots: Interval[]; timeZone: string; fromCalendar: boolean }> {
  const [hours, settings, connection] = await Promise.all([workingHours(), loadSettings(), googleConnection()]);
  const useCalendar = connection.status === "connected" && connection.canUseCalendar && settings.calendarAvailability;
  if (!useCalendar) return { slots: [], timeZone: hours.timeZone, fromCalendar: false };
  const until = new Date(now.getTime() + 14 * 86_400_000);
  const busy = await busyTimes(settings.calendarId, now, until);
  return { slots: freeSlots(busy, hours, { from: now, days: 14 }), timeZone: hours.timeZone, fromCalendar: true };
}

/**
 * Puts an agreed interview on the dashboard (the application's next
 * interview) and, when allowed, in the calendar. Returns the event's link.
 */
export async function scheduleInterview(applicationId: string, start: Date): Promise<CalendarSync> {
  const { count } = await prisma.application.updateMany({ where: { id: applicationId }, data: { nextInterviewAt: start } });
  if (count === 0) throw new GoogleError("unavailable", "That application no longer exists.");
  return syncInterviewToCalendar(applicationId);
}

/** What happened in the calendar: nothing while it isn't in use, else the event's link while there is one. */
export type CalendarSync = { inCalendar: boolean; eventLink: string | null };

/** Whether Dossier keeps interviews in the calendar: connected, allowed, and switched on in Settings → Google. */
async function calendarInUse(): Promise<{ calendarId: string } | null> {
  const [connection, settings] = await Promise.all([googleConnection(), loadSettings()]);
  if (connection.status !== "connected" || !connection.canUseCalendar || !settings.calendarEvents) return null;
  return { calendarId: settings.calendarId };
}

const eventFor = (application: { id: string; company: string; role: string; title: string }) => {
  const what = [application.role || application.title, application.company].filter(Boolean).join(" · ");
  return {
    applicationId: application.id,
    summary: `Interview · ${what || "application"}`,
    description: `Added by Dossier for your application${application.company ? ` to ${application.company}` : ""}.`,
  };
};

/**
 * Brings the calendar in step with the application's next interview: adds
 * the event, moves it (keeping its length), or deletes it when the date is
 * gone. An event deleted in Google is added again. Does nothing while
 * Dossier doesn't keep interviews in the calendar.
 */
export async function syncInterviewToCalendar(applicationId: string): Promise<CalendarSync> {
  const inUse = await calendarInUse();
  if (!inUse) return { inCalendar: false, eventLink: null };
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, company: true, role: true, title: true, nextInterviewAt: true, interviewEventId: true, interviewCalendarId: true },
  });
  if (!application) return { inCalendar: false, eventLink: null };
  const { calendarId } = inUse;
  const linked = application.interviewEventId && application.interviewCalendarId ? { eventId: application.interviewEventId, calendarId: application.interviewCalendarId } : null;
  const forget = () => prisma.application.updateMany({ where: { id: applicationId }, data: { interviewEventId: null, interviewCalendarId: null } });

  if (!application.nextInterviewAt) {
    if (linked) {
      await deleteEvent(linked.calendarId, linked.eventId);
      await forget();
    }
    return { inCalendar: true, eventLink: null };
  }

  const hours = await workingHours();
  const start = application.nextInterviewAt;
  // The event that's there, unless it's gone or in another calendar than the one chosen now.
  let current = linked ? await getEvent(linked.calendarId, linked.eventId) : null;
  if (current && linked && linked.calendarId !== calendarId) {
    await deleteEvent(linked.calendarId, linked.eventId);
    current = null;
  }
  if (current?.start && current.end) {
    if (current.start.getTime() === start.getTime()) return { inCalendar: true, eventLink: current.link || null };
    const length = current.end.getTime() - current.start.getTime();
    const moved = await moveEvent(calendarId, current.id, { start, end: new Date(start.getTime() + length), timeZone: hours.timeZone });
    return { inCalendar: true, eventLink: moved.link || null };
  }
  if (current) await deleteEvent(calendarId, current.id);

  const created = await createEvent(calendarId, { ...eventFor(application), start, end: new Date(start.getTime() + hours.slotMinutes * 60_000), timeZone: hours.timeZone });
  await prisma.application.updateMany({ where: { id: applicationId }, data: { interviewEventId: created.id, interviewCalendarId: calendarId } });
  return { inCalendar: true, eventLink: created.htmlLink };
}

/**
 * Takes changes made in Google back into Dossier: an interview whose event
 * was moved gets its new time, one whose event was deleted loses its date.
 * For all linked applications, or the one given. Returns how many changed.
 */
export async function pullInterviewEvents({ applicationId, signal }: { applicationId?: string; signal?: AbortSignal } = {}): Promise<number> {
  if (!(await calendarInUse())) return 0;
  const linked = await prisma.application.findMany({
    where: { ...(applicationId ? { id: applicationId } : {}), interviewEventId: { not: null }, interviewCalendarId: { not: null } },
    select: { id: true, nextInterviewAt: true, interviewEventId: true, interviewCalendarId: true },
  });
  let changed = 0;
  for (const application of linked) {
    if (signal?.aborted) break;
    const event = await getEvent(application.interviewCalendarId!, application.interviewEventId!, signal);
    if (!event) {
      await prisma.application.updateMany({ where: { id: application.id }, data: { nextInterviewAt: null, interviewEventId: null, interviewCalendarId: null } });
      changed++;
    } else if (event.start && event.start.getTime() !== application.nextInterviewAt?.getTime()) {
      await prisma.application.updateMany({ where: { id: application.id }, data: { nextInterviewAt: event.start } });
      changed++;
    }
  }
  return changed;
}
