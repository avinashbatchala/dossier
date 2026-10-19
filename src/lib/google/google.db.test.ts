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
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "Europe/Berlin", lastKnownTimeZone: async () => "Europe/Berlin" }));

import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";

import { sendApplicationEmail, sendReply } from "./send";
import { syncInbox } from "./sync";

const prisma = () => db.client!;
const b64 = (text: string) => Buffer.from(text).toString("base64url");

/** `history`: when Gmail added it; before the mailbox's 200 unless given. */
type Mail = { id: string; threadId: string; from: string; subject: string; text: string; labels?: string[]; date?: string; history?: number };
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
  if (mail) return json(gmailMessage(mail));
  return new Response("not found", { status: 404 });
}

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
    reply: () => ({ kind: "INTERVIEW", summary: "Invites you to a call.", questions: ["What is your notice period?"], confirmedTime: null }),
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
  it("links replies in a known thread or from the company's domain, and has the AI read them", async () => {
    await sendApplicationEmail("nw");
    mailbox = [
      { id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Could we talk next week?\n\nOn Mon, Jane wrote:\n> I'm applying" },
      { id: "m2", threadId: "t2", from: "HR <hr@northwind.example>", subject: "Your application", text: "Thanks!" },
      { id: "m3", threadId: "t3", from: "Friend <friend@gmail.com>", subject: "Lunch?", text: "Tomorrow?" },
      { id: "m4", threadId: "t4", from: "Deals <deals@shop.example>", subject: "Sale", text: "50% off", labels: ["INBOX", "CATEGORY_PROMOTIONS"] },
    ];
    const result = await syncInbox();
    expect(result).toEqual({ fetched: 4, kept: 2, read: 2 });

    const kept = await prisma().emailMessage.findMany({ where: { direction: "INCOMING" }, orderBy: { gmailId: "asc" } });
    expect(kept.map((email) => [email.gmailId, email.applicationId, email.kind, email.suggestedStatus])).toEqual([
      ["m1", "nw", "INTERVIEW", "INTERVIEW"],
      ["m2", "nw", "INTERVIEW", "INTERVIEW"],
    ]);
    expect(kept[0].body).toBe("Could we talk next week?");
    expect(kept[0].questions).toEqual(["What is your notice period?"]);
    const account = await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } });
    expect(account).toMatchObject({ historyId: "200", syncProblem: null });

    // The next check carries on from the history: only what's new since.
    mailbox.push({ id: "m6", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Wednesday 14:00 works.", history: 250 });
    expect(await syncInbox()).toEqual({ fetched: 1, kept: 1, read: 1 });
    expect((await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).historyId).toBe("300");
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
