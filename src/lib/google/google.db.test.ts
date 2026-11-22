import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase } from "@/test/db";

// The inbox check and Send with Gmail (E15-2, E15-3) against a test
// database, with Google's APIs answered by a fake fetch.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", DOSSIER_DATA_DIR: "/tmp" },
}));
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: async () => new Uint8Array([37, 80, 68, 70]) }));
vi.mock("@/lib/notifications/notify", () => ({ emit: vi.fn(async () => 0) }));
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "Europe/Berlin", lastKnownTimeZone: async () => "Europe/Berlin" }));

import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";

import { googleConnection, saveGoogleAccount } from "./account";
import { sendApplicationEmail, sendReply } from "./send";
import { syncInbox } from "./sync";

const prisma = () => db.client!;
const b64 = (text: string) => Buffer.from(text).toString("base64url");

/**
 * `history`: when Gmail added it; before the mailbox's 200 unless given.
 * `deleted`: listed, but gone when fetched. `refuse`: how many times Gmail
 * answers 403 for its rate limit before giving it (Infinity: always);
 * `forbid`: 403 for a missing permission.
 */
type Mail = { id: string; threadId: string; from: string; subject: string; text: string; labels?: string[]; date?: string; history?: number; deleted?: boolean; refuse?: number; forbid?: boolean };
const gmailMessage = ({ id, threadId, from, subject, text, labels = ["INBOX"], date = "2026-10-17T13:02:00Z" }: Mail) => ({
  id,
  threadId,
  labelIds: labels,
  internalDate: String(new Date(date).getTime()),
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: from },
      { name: "To", value: "jane@gmail.com" },
      { name: "Subject", value: subject },
      { name: "Message-ID", value: `<${id}@mail.example>` },
    ],
    parts: [{ mimeType: "text/plain", body: { data: b64(text) } }],
  },
});

let mailbox: Mail[] = [];
let sent: { raw: string; threadId?: string }[] = [];

function fakeGoogle(url: string, init?: RequestInit): Response {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const path = new URL(url).pathname;
  if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600, scope: "" });
  if (path.endsWith("/profile")) return json({ historyId: "200" });
  if (path.endsWith("/messages") && (init?.method ?? "GET") === "GET") return json({ messages: mailbox.map((mail) => ({ id: mail.id })) });
  if (path.endsWith("/history")) {
    const start = Number(new URL(url).searchParams.get("startHistoryId"));
    const added = mailbox.filter((mail) => (mail.history ?? 150) > start);
    return json({ history: [{ messagesAdded: added.map((mail) => ({ message: { id: mail.id } })) }], historyId: "300" });
  }
  if (path.endsWith("/messages/send")) {
    const body = JSON.parse(String(init?.body)) as { raw: string; threadId?: string };
    sent.push(body);
    return json({ id: `sent-${sent.length}`, threadId: body.threadId ?? "thread-new" });
  }
  const id = /messages\/([^/?]+)/.exec(path)?.[1];
  const mail = mailbox.find((entry) => entry.id === id);
  const refused = (reason: string) =>
    new Response(JSON.stringify({ error: { code: 403, message: reason, errors: [{ reason, domain: "usageLimits" }] } }), { status: 403, headers: { "content-type": "application/json", "retry-after": "0" } });
  if (mail?.forbid) return refused("insufficientPermissions");
  if (mail?.refuse) {
    mail.refuse -= 1;
    return refused("rateLimitExceeded");
  }
  if (mail && !mail.deleted) return json(gmailMessage(mail));
  return new Response("not found", { status: 404 });
}

/** Earlier tests leave an hour-long access token in memory; without it, the refresh token is asked for. */
const forgetAccessTokens = () => (globalThis as { googleTokens?: Map<string, unknown> }).googleTokens?.clear();

const scopes = "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";

beforeEach(async () => {
  await resetDatabase(prisma());
  mailbox = [];
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => fakeGoogle(String(url), init)));
  await prisma().googleAccount.create({ data: { email: "jane@gmail.com", refreshTokenEnc: encryptSecret(GOOGLE_TOKEN, "refresh", "s".repeat(40)), scopes } });
  await prisma().profileField.create({ data: { key: "name", value: "Jane Doe" } });
  await prisma().application.create({
    data: {
      id: "nw",
      company: "Northwind Logistics",
      role: "Product Designer",
      status: "DRAFT",
      postingText: "Apply to careers@northwind.example.",
      documents: {
        create: [
          { kind: "EMAIL", units: [{ id: "to", label: "Recipient", text: "careers@northwind.example" }, { id: "subject", label: "Subject", text: "Application: Product Designer" }, { id: "body", label: "Message", text: "Dear team,\n\nI'm applying.\n\nJane" }] },
          { kind: "RESUME", units: [] },
        ],
      },
    },
  });
  provider.current = new MockProvider({
    reply: () => ({ kind: "INTERVIEW", summary: "Invites you to a call.", questions: ["What is your notice period?"], confirmedTime: null, unrelated: false }),
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma().$disconnect());

describe("Send with Gmail (E15-2)", () => {
  it("sends with the PDFs, keeps the thread and moves the draft to Sent", async () => {
    const result = await sendApplicationEmail("nw");
    expect(result.eventId).not.toBeNull();
    expect(result.attachments).toHaveLength(1);
    const raw = Buffer.from(sent[0].raw, "base64url").toString("utf8");
    expect(raw).toContain("From: Jane Doe <jane@gmail.com>");
    expect(raw).toContain("To: careers@northwind.example");
    expect(raw).toContain("application/pdf");
    const application = await prisma().application.findUniqueOrThrow({ where: { id: "nw" } });
    expect(application).toMatchObject({ status: "SENT", emailThreadId: "thread-new" });
    expect(await prisma().emailMessage.count({ where: { applicationId: "nw", direction: "OUTGOING" } })).toBe(1);
  });
});

describe("the inbox check (E15-3)", () => {
  it("fills in the application's offer from a reply read as one, once (E30-7)", async () => {
    await sendApplicationEmail("nw");
    provider.current = new MockProvider({
      reply: () => ({
        kind: "OFFER",
        summary: "Offers you the role.",
        questions: [],
        confirmedTime: null,
        unrelated: false,
        offer: { salary: "€82,000 a year", decideBy: "2026-12-11", startDate: null, holidays: "27 days", office: "" },
      }),
    });
    const thread = (await prisma().application.findUniqueOrThrow({ where: { id: "nw" } })).emailThreadId!;
    mailbox = [{ id: "m9", threadId: thread, from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "We'd love to offer you the role.", history: 250 }];
    await syncInbox();
    expect(await prisma().offer.findUniqueOrThrow({ where: { applicationId: "nw" } })).toMatchObject({ salary: "€82,000 a year", decideBy: new Date("2026-12-11T00:00:00Z"), holidays: "27 days", fromEmailId: expect.any(String) });
  });

  it("links replies in a known thread or from the company's domain, and has the AI read them", async () => {
    await sendApplicationEmail("nw");
    mailbox = [
      { id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Could we talk next week?\n\nOn Mon, Jane wrote:\n> I'm applying" },
      { id: "m2", threadId: "t2", from: "HR <hr@northwind.example>", subject: "Your application", text: "Thanks!" },
      { id: "m3", threadId: "t3", from: "Friend <friend@gmail.com>", subject: "Lunch?", text: "Tomorrow?" },
      { id: "m4", threadId: "t4", from: "Deals <deals@shop.example>", subject: "Sale", text: "50% off", labels: ["INBOX", "CATEGORY_PROMOTIONS"] },
    ];
    const result = await syncInbox();
    expect(result).toEqual({ fetched: 4, kept: 2, read: 2, unread: 0 });

    const kept = await prisma().emailMessage.findMany({ where: { direction: "INCOMING" }, orderBy: { gmailId: "asc" } });
    expect(kept.map((email) => [email.gmailId, email.applicationId, email.kind, email.suggestedStatus])).toEqual([
      // One suggestion per application (#358): the last mail's, as they were sent at the same time.
      ["m1", "nw", "INTERVIEW", null],
      ["m2", "nw", "INTERVIEW", "INTERVIEW"],
    ]);
    expect(kept[0].body).toBe("Could we talk next week?");
    expect(kept[0].questions).toEqual(["What is your notice period?"]);
    const account = await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } });
    expect(account).toMatchObject({ historyId: "200", syncProblem: null });

    // The next check carries on from the history: only what's new since.
    mailbox.push({ id: "m6", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Wednesday 14:00 works.", history: 250 });
    expect(await syncInbox()).toEqual({ fetched: 1, kept: 1, read: 1, unread: 0 });
    expect((await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).historyId).toBe("300");
  });

  it("says who replied about which application on a scheduled check, never what they wrote (E26-6)", async () => {
    const { emit } = await import("@/lib/notifications/notify");
    vi.mocked(emit).mockClear();
    await sendApplicationEmail("nw");
    mailbox = [
      { id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Could we talk next week?" },
      { id: "m3", threadId: "t3", from: "Friend <friend@gmail.com>", subject: "Lunch?", text: "Tomorrow?" },
    ];
    await syncInbox({ notify: true });
    const application = await prisma().application.findUniqueOrThrow({ where: { id: "nw" } });
    expect(vi.mocked(emit).mock.calls).toEqual([["reply.arrived", { applicationId: "nw", from: "Anna Keller", title: application.role || application.title, company: application.company }]]);
    expect(JSON.stringify(vi.mocked(emit).mock.calls)).not.toContain("Could we talk");

    // "Check now" never sends it.
    vi.mocked(emit).mockClear();
    mailbox.push({ id: "m6", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Wednesday works.", history: 250 });
    await syncInbox();
    expect(emit).not.toHaveBeenCalled();
  });

  it("skips mail deleted since Gmail listed it, and carries on from the history", async () => {
    await sendApplicationEmail("nw");
    await syncInbox();
    mailbox = [
      { id: "spam", threadId: "t8", from: "Spam <win@prize.example>", subject: "You won", text: "Click", labels: ["SPAM"], history: 250, deleted: true },
      { id: "m7", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Thursday?", history: 250 },
    ];
    expect(await syncInbox()).toEqual({ fetched: 2, kept: 1, read: 1, unread: 0 });
    expect(await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).toMatchObject({ historyId: "300", syncProblem: null });
  });

  it("asks again when Gmail refuses a message for its rate limit, and leaves one it keeps refusing for the next check (public issue 68)", async () => {
    await sendApplicationEmail("nw");
    await syncInbox();
    mailbox = [
      { id: "m7", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Thursday?", history: 250, refuse: 2 },
      { id: "m8", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Or Friday?", history: 260, refuse: Infinity },
    ];
    expect(await syncInbox()).toEqual({ fetched: 2, kept: 1, read: 1, unread: 1 });
    expect(await prisma().emailMessage.findFirst({ where: { gmailId: "m7" } })).toMatchObject({ applicationId: "nw", kind: "INTERVIEW" });
    // The history stays where it was, so m8 is listed again next time, and Settings says so.
    expect(await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).toMatchObject({
      historyId: "200",
      syncProblem: "1 message couldn't be read from Gmail. The next check tries again.",
    });
    mailbox[1].refuse = 0;
    expect(await syncInbox()).toEqual({ fetched: 1, kept: 1, read: 1, unread: 0 });
    expect(await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).toMatchObject({ historyId: "300", syncProblem: null });

    // A 403 for a missing permission still stops the check, as before.
    mailbox.push({ id: "m9", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Hi", history: 350, forbid: true });
    await expect(syncInbox()).rejects.toThrow("Google refused that. Check the permissions in Settings → Google.");
    expect(await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).toMatchObject({ syncProblem: "Google refused that. Check the permissions in Settings → Google." });
  });

  it("stops asking Google once it refuses the saved access, until the account is connected again (#136)", async () => {
    forgetAccessTokens();
    let tokenCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (!String(url).startsWith("https://oauth2.googleapis.com/token")) return fakeGoogle(String(url), init);
        tokenCalls += 1;
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }),
    );
    await expect(syncInbox()).rejects.toThrow("Google no longer accepts Dossier's access.");
    expect(await googleConnection()).toMatchObject({ status: "connected", signInProblem: expect.stringContaining("Connect your Google account again") });
    await expect(syncInbox()).rejects.toThrow("Google no longer accepts Dossier's access.");
    expect(tokenCalls).toBe(1);

    await saveGoogleAccount({ email: "jane@gmail.com", refreshToken: "new-refresh", scopes });
    expect(await googleConnection()).toMatchObject({ signInProblem: null, syncProblem: null });
  });

  it("pauses, but keeps, saved access it can't read, since the old DOSSIER_SECRET reads it again (#136)", async () => {
    forgetAccessTokens();
    const other = encryptSecret(GOOGLE_TOKEN, "refresh", "o".repeat(40));
    await prisma().googleAccount.update({ where: { id: "google" }, data: { refreshTokenEnc: other } });
    expect(await googleConnection()).toMatchObject({ signInProblem: expect.stringContaining("DOSSIER_SECRET changed") });
    await expect(syncInbox()).rejects.toThrow("can't be read");
    expect(await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).toMatchObject({ refreshTokenEnc: other });
  });

  it("unlinks a mail matched by the company's name or domain that the AI finds unrelated, and keeps a thread's reply linked (public issue 65)", async () => {
    await sendApplicationEmail("nw");
    provider.current = new MockProvider({
      reply: (call) => {
        const other = String(call.messages[0].content).includes("200061456");
        return { kind: other ? "REJECTION" : "INTERVIEW", summary: other ? "Declines the support role." : "Invites you.", questions: [], confirmedTime: null, unrelated: other };
      },
    });
    mailbox = [
      { id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "We won't go ahead with Technical Support Engineering 200061456." },
      { id: "m2", threadId: "t2", from: "Careers <careers@northwind.example>", subject: "Your application", text: "Technical Support Engineering 200061456: we won't go ahead." },
      { id: "m3", threadId: "t2", from: "Careers <careers@northwind.example>", subject: "Re: Your application", text: "Best wishes." },
    ];
    expect(await syncInbox()).toEqual({ fetched: 3, kept: 3, read: 3, unread: 0 });
    const kept = await prisma().emailMessage.findMany({ where: { direction: "INCOMING" }, orderBy: { gmailId: "asc" } });
    expect(kept.map((email) => [email.gmailId, email.applicationId, email.kind, email.suggestedStatus])).toEqual([
      // In the thread Dossier wrote in: linked whatever it says.
      ["m1", "nw", "REJECTION", "REJECTED"],
      // By the domain only, and about another role: waits for a look, with the rest of its thread.
      ["m2", null, "REJECTION", null],
      ["m3", null, "INTERVIEW", null],
    ]);
  });

  it("logs no mail content when reading fails or Gmail refuses a mail (#358)", async () => {
    const logged: string[] = [];
    const spies = (["error", "warn", "log", "info"] as const).map((level) => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" "))));
    try {
      await sendApplicationEmail("nw");
      // The model fails in a way that echoes what it was given.
      provider.current = new MockProvider({ reply: (call) => Promise.reject(new Error(`Bad request: ${String(call.messages[0].content)}`)) });
      mailbox = [{ id: "m1", threadId: "thread-new", from: "Anna Keller <anna.keller@northwind.example>", subject: "Re: Application, salary 81,500", text: "Your notice period is ZEBRA-7731, right?" }];
      expect(await syncInbox()).toMatchObject({ kept: 1, read: 0 });
      // A refused mail stops the check, which says so in Settings; that's logged too.
      mailbox = [...mailbox, { id: "m2", threadId: "t2", from: "Hidden Sender <hidden.sender@northwind.example>", subject: "Private subject QUOKKA", text: "Private body QUOKKA", forbid: true, history: 250 }];
      await expect(syncInbox()).rejects.toThrow();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(logged.some((line) => line.startsWith("[reading a reply]"))).toBe(true);
    expect(logged.some((line) => line.startsWith("[inbox check]"))).toBe(true);
    for (const secret of ["ZEBRA-7731", "81,500", "anna.keller", "Anna Keller", "QUOKKA", "hidden.sender", "notice period"]) {
      expect(logged.join("\n"), secret).not.toContain(secret);
    }
  });

  it("keeps one status suggestion per application, the newest mail's, whatever order they're read in (#358)", async () => {
    await sendApplicationEmail("nw");
    mailbox = [
      { id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Could we talk?", date: "2026-10-18T09:00:00Z" },
      { id: "m2", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Could we talk next week?", date: "2026-10-17T09:00:00Z" },
    ];
    await syncInbox();
    const kept = await prisma().emailMessage.findMany({ where: { direction: "INCOMING" }, orderBy: { gmailId: "asc" } });
    expect(kept.map((email) => [email.gmailId, email.suggestedStatus])).toEqual([
      ["m1", "INTERVIEW"],
      ["m2", null],
    ]);
  });

  it("keeps a thread moved to another application there, even the one it was sent from (public #134)", async () => {
    await sendApplicationEmail("nw");
    await prisma().application.create({ data: { id: "lg", company: "Ledgerly", role: "Designer", status: "SENT" } });
    mailbox = [{ id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Could we talk?" }];
    await syncInbox();
    // Moved by hand, as the application's Email tab does.
    await prisma().emailMessage.updateMany({ where: { threadId: "thread-new" }, data: { applicationId: "lg" } });
    mailbox.push({ id: "m2", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Wednesday?", history: 250 });
    await syncInbox();
    expect((await prisma().emailMessage.findFirstOrThrow({ where: { gmailId: "m2" } })).applicationId).toBe("lg");
  });

  it("leaves out drafts, even in a known thread", async () => {
    await sendApplicationEmail("nw");
    mailbox = [{ id: "d1", threadId: "thread-new", from: "Jane Doe <jane@gmail.com>", subject: "Re: Application", text: "Hi Anna,", labels: ["DRAFT"] }];
    expect(await syncInbox()).toEqual({ fetched: 1, kept: 0, read: 0, unread: 0 });
    expect(await prisma().emailMessage.findFirst({ where: { gmailId: "d1" } })).toBeNull();
  });

  it("keeps unmatched inbox mail for a look when set to read everything", async () => {
    await prisma().setting.create({ data: { key: "gmailScope", value: "all" } });
    mailbox = [{ id: "m5", threadId: "t5", from: "Recruiter <talent@acme-hr.example>", subject: "Senior Designer role", text: "Interested?" }];
    await syncInbox();
    expect(await prisma().emailMessage.findFirst({ where: { gmailId: "m5" } })).toMatchObject({ applicationId: null });
  });

  it("answers in the thread and marks the reply as answered", async () => {
    await sendApplicationEmail("nw");
    mailbox = [{ id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Notice period?" }];
    await syncInbox();
    const reply = await prisma().emailMessage.findFirstOrThrow({ where: { gmailId: "m1" } });

    await expect(sendReply(reply.id, "Hi Anna, it's […].")).rejects.toThrow("Fill in the parts marked […] first.");
    await sendReply(reply.id, "Hi Anna,\n\nThree months.\n\nJane");
    const raw = Buffer.from(sent.at(-1)!.raw, "base64url").toString("utf8");
    expect(sent.at(-1)!.threadId).toBe("thread-new");
    expect(raw).toContain("Subject: Re: Application");
    expect(raw).toContain("In-Reply-To: <m1@mail.example>");
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ handledAt: expect.any(Date) });
  });
});
