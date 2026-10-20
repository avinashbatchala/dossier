import "server-only";

import { z } from "zod";

import { googleFetch } from "./account";
import { googleUrl } from "./endpoints";
import { GoogleError } from "./errors";
import type { Interval } from "./slots";

// The parts of the Calendar API Dossier uses (E15-5): free/busy for times to
// offer, and events for interviews and the dashboard's calendar.

const api = (path: string) => googleUrl("www", `/calendar/v3${path}`);
const eventPath = (calendarId: string, eventId?: string) =>
  `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;

/** The private property that ties an event Dossier added to its application. */
const APPLICATION_PROPERTY = "dossierApplication";

/** Busy times in the calendar between `from` and `to`. */
export async function busyTimes(calendarId: string, from: Date, to: Date, signal?: AbortSignal): Promise<Interval[]> {
  const answer = await googleFetch<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>("calendar", api("/freeBusy"), {
    method: "POST",
    body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: calendarId }] },
    signal,
  });
  const calendar = answer.calendars?.[calendarId] ?? Object.values(answer.calendars ?? {})[0];
  return (calendar?.busy ?? []).map((entry) => ({ start: new Date(entry.start), end: new Date(entry.end) }));
}

export type InterviewEvent = {
  /** The application it's for, kept on the event so the dashboard's calendar can link it. */
  applicationId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
};

/** Adds an interview; returns its id and link. */
export async function createEvent(calendarId: string, event: InterviewEvent): Promise<{ id: string; htmlLink: string }> {
  const created = await googleFetch<{ id: string; htmlLink: string }>("calendar", api(`${eventPath(calendarId)}?sendUpdates=none`), {
    method: "POST",
    body: {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
      end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
      reminders: { useDefault: true },
      extendedProperties: { private: { [APPLICATION_PROPERTY]: event.applicationId } },
    },
  });
  return { id: created.id, htmlLink: created.htmlLink };
}

const time = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() });
const eventSchema = z.object({
  id: z.string(),
  status: z.string().default("confirmed"),
  summary: z.string().default(""),
  htmlLink: z.string().default(""),
  start: time.default({}),
  end: time.default({}),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});

/** An event as Dossier reads it. All-day events have dates ("2026-10-20", the end one day after the last) instead of times. */
export type CalendarEvent = {
  id: string;
  title: string;
  /** Cancelled events only come back when asked for one by its id. */
  cancelled: boolean;
  start: Date | null;
  end: Date | null;
  startDate: string | null;
  endDate: string | null;
  link: string;
  /** The application of an interview Dossier added. */
  applicationId: string | null;
};

function readEvent(json: unknown): CalendarEvent {
  const event = eventSchema.parse(json);
  return {
    id: event.id,
    title: event.summary,
    cancelled: event.status === "cancelled",
    start: event.start.dateTime ? new Date(event.start.dateTime) : null,
    end: event.end.dateTime ? new Date(event.end.dateTime) : null,
    startDate: event.start.date ?? null,
    endDate: event.end.date ?? null,
    link: event.htmlLink,
    applicationId: event.extendedProperties?.private?.[APPLICATION_PROPERTY] ?? null,
  };
}

/** Whether a failure means the event is gone: deleted, or never there. */
export const isGone = (error: unknown) => error instanceof GoogleError && (error.status === 404 || error.status === 410);

/** One event, or null when it's been deleted. */
export async function getEvent(calendarId: string, eventId: string, signal?: AbortSignal): Promise<CalendarEvent | null> {
  try {
    const event = readEvent(await googleFetch("calendar", api(eventPath(calendarId, eventId)), { signal }));
    return event.cancelled ? null : event;
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
}

/** Moves an event to a new start and end. */
export async function moveEvent(calendarId: string, eventId: string, { start, end, timeZone }: { start: Date; end: Date; timeZone: string }): Promise<CalendarEvent> {
  return readEvent(
    await googleFetch("calendar", api(`${eventPath(calendarId, eventId)}?sendUpdates=none`), {
      method: "PATCH",
      body: { start: { dateTime: start.toISOString(), timeZone }, end: { dateTime: end.toISOString(), timeZone } },
    }),
  );
}

/** Deletes an event; one that's already gone is fine. */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  try {
    await googleFetch("calendar", api(`${eventPath(calendarId, eventId)}?sendUpdates=none`), { method: "DELETE" });
  } catch (error) {
    if (!isGone(error)) throw error;
  }
}

/** The events between `from` and `to`, recurring ones as single events, in order. At most 1,000. */
export async function listEvents(calendarId: string, from: Date, to: Date, signal?: AbortSignal): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 4; page++) {
    const url = new URL(api(eventPath(calendarId)));
    url.search = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const answer = await googleFetch<{ items?: unknown[]; nextPageToken?: string }>("calendar", url, { signal });
    for (const item of answer.items ?? []) {
      const event = readEvent(item);
      if (!event.cancelled) events.push(event);
    }
    pageToken = answer.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}
