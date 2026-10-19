import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase } from "@/test/db";

// The Google actions and loaders (E15) against the test database, signed
// in, with Google's APIs answered by a fake fetch.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", DOSSIER_DATA_DIR: "/tmp" },
}));
const ai = vi.hoisted(() => ({ provider: undefined as unknown, ready: true }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ai.provider }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => ai.ready }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "Europe/Berlin", lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/jobs/runner", () => ({
  defineJob: <T,>(definition: T) => definition,
  findUnfinishedJobs: async () => [],
  startJob: async () => "job-1",
}));

import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";

import { googleConnection } from "./account";
import {
  applySuggestedStatus,
  confirmInterview,
  disconnectGoogleAccount,
  dismissEmail,
  linkEmail,
  loadFreeSlots,
  markHandled,
  rereadEmail,
  saveGoogleClient,
  saveGoogleSettings,
  saveReplyDraft,
  startDraftingReply,
} from "./actions";
import { inboxCount, loadConversation, loadInbox, waitingByApplication } from "./inbox-data";

const prisma = () => db.client!;
const scopes = [
  "openid email",
  "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events",
].join(" ");
let calls: { url: string; body: unknown }[] = [];

beforeEach(async () => {
  await resetDatabase(prisma());
  calls = [];
  ai.ready = true;
  ai.provider = new MockProvider({ reply: () => ({ kind: "OFFER", summary: "Makes you an offer.", questions: [], confirmedTime: null }) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, body: init?.body ? (String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : String(init.body)) : undefined });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (href.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600 });
      if (href.startsWith("https://oauth2.googleapis.com/revoke")) return json({});
      if (href.endsWith("/freeBusy")) return json({ calendars: { primary: { busy: [] } } });
      if (href.includes("/events")) return json({ id: "ev1", htmlLink: "https://calendar.google.com/event?eid=ev1" });
      return new Response("", { status: 404 });
    }),
  );
  await prisma().googleAccount.create({ data: { email: "jane@gmail.com", refreshTokenEnc: encryptSecret(GOOGLE_TOKEN, "refresh", "s".repeat(40)), scopes } });
  await prisma().application.create({ data: { id: "nw", company: "Northwind", role: "Product Designer", status: "SENT", furthestStage: "SENT", sentAt: new Date() } });
  await prisma().application.create({ data: { id: "lg", company: "Ledgerly", role: "Designer", status: "SENT", furthestStage: "SENT", sentAt: new Date() } });
  const base = { direction: "INCOMING" as const, fromName: "Anna", fromAddress: "anna@northwind.example", subject: "Re: Application", sentAt: new Date("2026-10-17T13:00:00Z") };
  await prisma().emailMessage.createMany({
    data: [
      { ...base, id: "e1", gmailId: "g1", threadId: "t1", applicationId: "nw", body: "Could we talk?", kind: "INTERVIEW", summary: "Invites you to a call.", questions: ["When are you free?"], suggestedStatus: "INTERVIEW", classifiedWith: "classify-reply@1" },
      { ...base, id: "e2", gmailId: "g2", threadId: "t2", applicationId: null, fromAddress: "talent@acme.example", body: "Interested in a role?" },
      { ...base, id: "e3", gmailId: "g3", threadId: "t1", applicationId: "nw", body: "Thanks!", kind: "ACKNOWLEDGEMENT", handledAt: new Date(), classifiedWith: "classify-reply@1" },
    ],
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma().$disconnect());

describe("the inbox (E15-3)", () => {
  it("sorts mail into waiting, unmatched and updates", async () => {
    const inbox = await loadInbox();
    expect(inbox.waiting.map((email) => email.id)).toEqual(["e1"]);
    expect(inbox.unmatched.map((email) => email.id)).toEqual(["e2"]);
    expect(inbox.updates.map((email) => [email.id, email.handled, email.read])).toEqual([["e3", true, true]]);
    expect(inbox.waiting[0]).toMatchObject({ questions: ["When are you free?"], application: { id: "nw", company: "Northwind", status: "SENT" } });
    expect(await inboxCount()).toBe(2);
    expect(await waitingByApplication()).toEqual(new Map([["nw", { count: 1, summary: "Invites you to a call." }]]));
    expect((await loadConversation("nw")).map((email) => email.id)).toEqual(["e1", "e3"]);
  });

  it("links a mail and its thread, or hides it", async () => {
    expect(await linkEmail({ emailId: "e2", applicationId: "lg" })).toMatchObject({ ok: true });
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: "e2" } })).toMatchObject({ applicationId: "lg" });
    expect(await linkEmail({ emailId: "e2", applicationId: "gone" })).toMatchObject({ ok: false, error: "That application no longer exists." });
    expect(await dismissEmail({ emailId: "e2" })).toMatchObject({ ok: true });
    expect((await loadInbox()).unmatched).toEqual([]);
  });

  it("keeps only the ids of a dismissed mail, and a link leaves it dismissed", async () => {
    await prisma().emailMessage.create({
      data: { id: "e4", gmailId: "g4", threadId: "t2", direction: "INCOMING", fromName: "Acme", fromAddress: "talent@acme.example", subject: "Hello", body: "More roles", sentAt: new Date("2026-10-17T14:00:00Z") },
    });
    await dismissEmail({ emailId: "e4" });
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: "e4" } })).toMatchObject({
      gmailId: "g4",
      threadId: "t2",
      fromName: "",
      fromAddress: "",
      subject: "",
      body: "",
      questions: null,
      dismissedAt: expect.any(Date),
    });
    await linkEmail({ emailId: "e2", applicationId: "lg" });
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: "e4" } })).toMatchObject({ applicationId: null, dismissedAt: expect.any(Date) });
  });

  it("goes with its application", async () => {
    await prisma().application.delete({ where: { id: "nw" } });
    expect(await prisma().emailMessage.count({ where: { threadId: "t1" } })).toBe(0);
    expect(await prisma().emailMessage.count()).toBe(1);
  });

  it("marks a reply as answered and back", async () => {
    await markHandled({ emailId: "e1", handled: true });
    expect(await inboxCount()).toBe(1);
    await markHandled({ emailId: "e1", handled: false });
    expect(await inboxCount()).toBe(2);
  });

  it("has the AI read a mail again", async () => {
    await prisma().emailMessage.update({ where: { id: "e2" }, data: { applicationId: "lg" } });
    expect(await rereadEmail({ emailId: "e2" })).toMatchObject({ ok: true });
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: "e2" } })).toMatchObject({ kind: "OFFER", suggestedStatus: "OFFER" });
    ai.ready = false;
    expect(await rereadEmail({ emailId: "e2" })).toMatchObject({ ok: false });
  });
});

describe("the reply's suggestions (E15-4)", () => {
  it("moves the application through the status module, or lets it be", async () => {
    const accepted = await applySuggestedStatus({ emailId: "e1", accept: true });
    expect(accepted).toMatchObject({ ok: true, data: { eventId: expect.any(String) } });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: "nw" } })).toMatchObject({ status: "INTERVIEW", furthestStage: "INTERVIEW" });
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: "e1" } })).toMatchObject({ suggestedStatus: null });
    expect(await applySuggestedStatus({ emailId: "e1", accept: true })).toMatchObject({ ok: true, data: { eventId: null } });
  });

  it("starts and saves drafts", async () => {
    expect(await startDraftingReply({ emailId: "e1" })).toEqual({ ok: true, data: "job-1" });
    expect(await startDraftingReply({ emailId: "nope" })).toMatchObject({ ok: false });
    await saveReplyDraft({ emailId: "e1", body: "Hi Anna" });
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: "e1" } })).toMatchObject({ replyDraft: "Hi Anna" });
  });
});

describe("the calendar (E15-5)", () => {
  it("offers free working-hour times", async () => {
    const result = await loadFreeSlots({});
    expect(result).toMatchObject({ ok: true, data: { fromCalendar: true, timeZone: "Europe/Berlin" } });
    if (!result.ok) return;
    expect(result.data.slots.length).toBeGreaterThan(0);
    expect(result.data.slots[0].label).toMatch(/^\w{3} \d{1,2} \w{3}, \d{2}:\d{2}–\d{2}:\d{2}$/);
    expect(calls.some((call) => call.url.endsWith("/freeBusy"))).toBe(true);
  });

  it("adds an agreed interview to the calendar and the dashboard, and moves to Interview", async () => {
    const start = "2026-10-22T12:00:00.000Z";
    const result = await confirmInterview({ emailId: "e1", start, moveToInterview: true });
    expect(result).toMatchObject({ ok: true, data: { eventLink: "https://calendar.google.com/event?eid=ev1", eventId: expect.any(String) } });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: "nw" } })).toMatchObject({ status: "INTERVIEW", nextInterviewAt: new Date(start) });
    const event = calls.find((call) => call.url.includes("/events"))!.body as { summary: string; end: { dateTime: string } };
    expect(event.summary).toBe("Interview · Product Designer · Northwind");
    expect(event.end.dateTime).toBe("2026-10-22T12:45:00.000Z");
    expect(await confirmInterview({ emailId: "e2", start, moveToInterview: false })).toMatchObject({ ok: false, error: "Link this email to an application first." });
  });

  it("skips the calendar when that's off", async () => {
    await saveGoogleSettings({ calendarEvents: false, calendarAvailability: false });
    expect(await confirmInterview({ emailId: "e1", start: "2026-10-22T12:00:00.000Z", moveToInterview: false })).toMatchObject({ ok: true, data: { eventLink: null } });
    expect(await loadFreeSlots({})).toMatchObject({ ok: true, data: { slots: [], fromCalendar: false } });
  });
});

describe("Settings → Google (E15-1)", () => {
  it("saves the settings, refusing a day that ends before it starts or a made-up zone", async () => {
    expect(await saveGoogleSettings({ workDays: [3, 1, 1], workTimeZone: "America/New_York", gmailScope: "all" })).toMatchObject({ ok: true });
    const rows = Object.fromEntries((await prisma().setting.findMany()).map((row) => [row.key, row.value]));
    expect(rows).toMatchObject({ workDays: "[1,3]", workTimeZone: "America/New_York", gmailScope: "all" });
    expect(await saveGoogleSettings({ workStart: "17:00", workEnd: "09:00" })).toMatchObject({ ok: false });
    expect(await saveGoogleSettings({ workTimeZone: "Mars/Olympus" })).toMatchObject({ ok: false });
  });

  it("saves the OAuth client, the secret encrypted and never sent back", async () => {
    expect(await saveGoogleClient({ id: "client", secret: { action: "set", value: "new-secret" } })).toEqual({
      ok: true,
      data: { id: "client", idState: "set", secretState: "set" },
    });
    const stored = await prisma().setting.findUnique({ where: { key: "googleClientSecretEnc" } });
    expect(stored?.value).toMatch(/^v1\./);
    expect(stored?.value).not.toContain("new-secret");
    // Same client ID, new secret: the account stays connected.
    expect(await googleConnection()).toMatchObject({ status: "connected" });

    expect(await saveGoogleClient({ secret: { action: "clear" } })).toMatchObject({ ok: true, data: { secretState: "env" } });
    expect(await prisma().setting.count({ where: { key: "googleClientSecretEnc" } })).toBe(0);
  });

  it("disconnects when the client ID changes, since Google's grant belongs to it", async () => {
    expect(await saveGoogleClient({ id: "other-client" })).toMatchObject({ ok: true, data: { id: "other-client", idState: "set" } });
    expect(calls.find((call) => call.url.includes("/revoke"))).toBeDefined();
    expect(await googleConnection()).toEqual({ status: "disconnected" });
  });

  it("disconnects, revoking the token at Google", async () => {
    expect(await googleConnection()).toMatchObject({ status: "connected", email: "jane@gmail.com", canSend: true, canRead: true, canUseCalendar: true });
    expect(await disconnectGoogleAccount({})).toMatchObject({ ok: true, toast: "Disconnected from Google." });
    expect(calls.find((call) => call.url.includes("/revoke"))?.body).toBe("token=refresh");
    expect(await googleConnection()).toEqual({ status: "disconnected" });
    // Mail already in Dossier stays.
    expect(await prisma().emailMessage.count()).toBe(3);
  });
});
