import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

// Interviews kept in step with Google Calendar both ways (E15-5), against the
// test database and a fake Calendar API that keeps its events in memory.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", DOSSIER_DATA_DIR: "/tmp" },
}));
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "Europe/Berlin", lastKnownTimeZone: async () => "Europe/Berlin" }));

import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";

import { pullInterviewEvents, scheduleInterview, syncInterviewToCalendar } from "./availability";
import { loadCalendar } from "./calendar-data";

const prisma = () => db.client!;
const scopes = "openid email https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events";

type FakeEvent = { id: string; status: string; summary: string; start: { dateTime: string }; end: { dateTime: string }; extendedProperties?: unknown };
let events: Map<string, FakeEvent>;
let calls: string[];

beforeEach(async () => {
  await resetDatabase(prisma());
  events = new Map();
  calls = [];
  let next = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (href.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600 });
      const match = /\/calendars\/([^/]+)\/events(?:\/([^?]+))?/.exec(new URL(href).pathname);
      if (!match) return json({}, 404);
      calls.push(`${method} ${decodeURIComponent(match[1])}${match[2] ? ` ${match[2]}` : ""}`);
      const body = init?.body ? (JSON.parse(String(init.body)) as Partial<FakeEvent>) : {};
      if (method === "GET" && !match[2]) {
        const params = new URL(href).searchParams;
        const from = Date.parse(params.get("timeMin")!);
        const to = Date.parse(params.get("timeMax")!);
        const at = (time: FakeEvent["start"] & { date?: string }) => Date.parse(time.dateTime ?? `${time.date}T00:00:00Z`);
        const listed = [...events.values()].filter((event) => at(event.start) < to && at(event.end) > from);
        return json({ items: listed.map((event) => ({ ...event, htmlLink: `https://calendar.google.com/event?eid=${event.id}` })) });
      }
      if (method === "POST") {
        const event = { id: `ev${++next}`, status: "confirmed", summary: "", ...body } as FakeEvent;
        events.set(event.id, event);
        return json({ ...event, htmlLink: `https://calendar.google.com/event?eid=${event.id}` });
      }
      const event = match[2] ? events.get(match[2]) : undefined;
      if (!event) return json({ error: { code: 404 } }, 404);
      if (method === "DELETE") {
        events.delete(event.id);
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") Object.assign(event, body);
      return json({ ...event, htmlLink: `https://calendar.google.com/event?eid=${event.id}` });
    }),
  );
  await prisma().googleAccount.create({ data: { email: "jane@gmail.com", refreshTokenEnc: encryptSecret(GOOGLE_TOKEN, "refresh", "s".repeat(40)), scopes } });
  await prisma().application.create({ data: { id: "nw", company: "Northwind", role: "Product Designer", status: "INTERVIEW", furthestStage: "INTERVIEW" } });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma().$disconnect());

const application = () => prisma().application.findUniqueOrThrow({ where: { id: "nw" } });
const setDate = async (iso: string | null) => {
  await prisma().application.update({ where: { id: "nw" }, data: { nextInterviewAt: iso ? new Date(iso) : null } });
  return syncInterviewToCalendar("nw");
};

describe("Dossier to Google", () => {
  it("adds the interview, moves it keeping its length, and deletes it with the date", async () => {
    expect(await scheduleInterview("nw", new Date("2026-10-22T11:00:00Z"))).toEqual({ inCalendar: true, eventLink: "https://calendar.google.com/event?eid=ev1" });
    expect(await application()).toMatchObject({ interviewEventId: "ev1", interviewCalendarId: "primary" });
    const added = events.get("ev1")!;
    expect(added).toMatchObject({ summary: "Interview · Product Designer · Northwind", extendedProperties: { private: { dossierApplication: "nw" } } });
    expect(added.start).toEqual({ dateTime: "2026-10-22T11:00:00.000Z", timeZone: "Europe/Berlin" });
    expect(added.end.dateTime).toBe("2026-10-22T11:45:00.000Z");

    // Made an hour long in Google, then moved in Dossier: still an hour long.
    added.end.dateTime = "2026-10-22T12:00:00.000Z";
    await setDate("2026-10-23T09:00:00Z");
    expect(events.get("ev1")).toMatchObject({ start: { dateTime: "2026-10-23T09:00:00.000Z" }, end: { dateTime: "2026-10-23T10:00:00.000Z" } });
    expect(events.size).toBe(1);

    expect(await setDate(null)).toEqual({ inCalendar: true, eventLink: null });
    expect(events.size).toBe(0);
    expect(await application()).toMatchObject({ interviewEventId: null, interviewCalendarId: null });
  });

  it("adds the event again when it was deleted in Google, and leaves an unchanged one alone", async () => {
    await scheduleInterview("nw", new Date("2026-10-22T11:00:00Z"));
    calls = [];
    await syncInterviewToCalendar("nw");
    expect(calls).toEqual(["GET primary ev1"]);
    events.clear();
    await setDate("2026-10-24T09:00:00Z");
    expect([...events.keys()]).toEqual(["ev2"]);
    expect(await application()).toMatchObject({ interviewEventId: "ev2" });
  });

  it("moves the interview to the calendar chosen now", async () => {
    await scheduleInterview("nw", new Date("2026-10-22T11:00:00Z"));
    await prisma().setting.create({ data: { key: "calendarId", value: "work@group.calendar.google.com" } });
    await setDate("2026-10-22T13:00:00Z");
    expect(calls.slice(-3)).toEqual(["GET primary ev1", "DELETE primary ev1", "POST work@group.calendar.google.com"]);
    expect(await application()).toMatchObject({ interviewEventId: "ev2", interviewCalendarId: "work@group.calendar.google.com" });
  });

  it("does nothing while interviews aren't kept in the calendar", async () => {
    await prisma().setting.create({ data: { key: "calendarEvents", value: "false" } });
    expect(await scheduleInterview("nw", new Date("2026-10-22T11:00:00Z"))).toEqual({ inCalendar: false, eventLink: null });
    expect(calls).toEqual([]);
    expect((await application()).nextInterviewAt).toEqual(new Date("2026-10-22T11:00:00Z"));
  });
});

describe("Google to Dossier", () => {
  it("follows an event moved in Google, and drops the date when it's deleted", async () => {
    await scheduleInterview("nw", new Date("2026-10-22T11:00:00Z"));
    expect(await pullInterviewEvents()).toBe(0);

    events.get("ev1")!.start.dateTime = "2026-10-22T08:30:00+02:00";
    expect(await pullInterviewEvents({ applicationId: "nw" })).toBe(1);
    expect((await application()).nextInterviewAt).toEqual(new Date("2026-10-22T06:30:00Z"));

    events.get("ev1")!.status = "cancelled";
    expect(await pullInterviewEvents()).toBe(1);
    expect(await application()).toMatchObject({ nextInterviewAt: null, interviewEventId: null, interviewCalendarId: null });
  });

  it("does nothing while interviews aren't kept in the calendar", async () => {
    await scheduleInterview("nw", new Date("2026-10-22T11:00:00Z"));
    events.clear();
    await prisma().setting.create({ data: { key: "calendarEvents", value: "false" } });
    expect(await pullInterviewEvents()).toBe(0);
    expect((await application()).nextInterviewAt).toEqual(new Date("2026-10-22T11:00:00Z"));
  });
});

describe("the dashboard calendar's data (E15-6)", () => {
  const week = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

  it("shows Google's events with the interviews linked, and interviews that aren't in Google", async () => {
    await scheduleInterview("nw", new Date("2026-10-22T11:00:00Z"));
    await prisma().application.create({ data: { id: "lg", company: "Ledgerly", role: "Designer", status: "INTERVIEW", nextInterviewAt: new Date("2026-10-23T08:00:00Z") } });
    events.set("dentist", { id: "dentist", status: "confirmed", summary: "Dentist", start: { dateTime: "2026-10-21T13:00:00Z" }, end: { dateTime: "2026-10-21T13:30:00Z" } });
    events.set("trip", { id: "trip", status: "confirmed", summary: "", start: { date: "2026-10-24" } as never, end: { date: "2026-10-26" } as never });
    events.set("later", { id: "later", status: "confirmed", summary: "Next week", start: { dateTime: "2026-10-28T09:00:00Z" }, end: { dateTime: "2026-10-28T10:00:00Z" } });

    const calendar = await loadCalendar(week);
    expect(calendar).toMatchObject({ timeZone: "Europe/Berlin", source: { status: "google" } });
    const byId = Object.fromEntries(calendar.items.map((item) => [item.id, item]));
    expect(Object.keys(byId).sort()).toEqual(["dentist", "ev1", "interview-lg", "trip"]);
    expect(byId.ev1).toMatchObject({ kind: "interview", href: "/applications/nw", external: false, title: "Interview · Product Designer · Northwind" });
    expect(byId.dentist).toMatchObject({ kind: "event", href: "https://calendar.google.com/event?eid=dentist", external: true });
    expect(byId.trip).toMatchObject({ allDay: true, startDay: "2026-10-24", endDay: "2026-10-26", title: "(No title)" });
    expect(byId["interview-lg"]).toMatchObject({ kind: "interview", href: "/applications/lg", start: new Date("2026-10-23T08:00:00Z"), end: new Date("2026-10-23T08:45:00Z") });
  });

  it("shows only interviews, saying why, without the calendar", async () => {
    await prisma().application.update({ where: { id: "nw" }, data: { nextInterviewAt: new Date("2026-10-22T11:00:00Z") } });
    await prisma().googleAccount.update({ where: { id: "google" }, data: { scopes: "openid email" } });
    expect(await loadCalendar(week)).toMatchObject({ source: { status: "no-permission" }, items: [{ id: "interview-nw", kind: "interview" }] });
    await prisma().googleAccount.deleteMany();
    expect((await loadCalendar(week)).source).toEqual({ status: "not-connected" });
  });

  it("says when Google's calendar didn't load", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => (String(url).includes("/token") ? new Response(JSON.stringify({ access_token: "access", expires_in: 3600 })) : new Response("", { status: 500 }))));
    expect((await loadCalendar(week)).source).toEqual({ status: "failed", message: "Google had a problem with that. Try again in a moment." });
  });
});
