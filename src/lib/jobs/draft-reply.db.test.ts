import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase } from "@/test/db";

import { draftReplyJob } from "./draft-reply";

// Drafting an answer to an employer (E15-4), with the calendar's free times.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("@/lib/google/availability", () => ({
  workingHours: async () => ({ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timeZone: "Europe/Berlin", slotMinutes: 45, bufferMinutes: 15 }),
  proposeSlots: async () => ({
    timeZone: "Europe/Berlin",
    fromCalendar: true,
    slots: [
      { start: new Date("2026-10-20T08:00:00Z"), end: new Date("2026-10-20T08:45:00Z") },
      { start: new Date("2026-10-21T12:00:00Z"), end: new Date("2026-10-21T12:45:00Z") },
    ],
  }),
}));
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({ data: { id: "nw", company: "Northwind", role: "Product Designer", status: "SENT", postingText: "Northwind is hiring." } });
  const base = { threadId: "t1", applicationId: "nw", fromName: "Anna", fromAddress: "anna@northwind.example", subject: "Re: Application" };
  await prisma().emailMessage.create({ data: { ...base, id: "out", gmailId: "g0", direction: "OUTGOING", body: "I'm applying.", sentAt: new Date("2026-10-12T09:00:00Z") } });
  await prisma().emailMessage.create({ data: { ...base, id: "e1", gmailId: "g1", direction: "INCOMING", body: "Could we talk next week?", kind: "INTERVIEW", sentAt: new Date("2026-10-17T13:00:00Z") } });
  provider.current = new MockProvider({ reply: () => ({ greeting: "Hi Anna,", paragraphs: ["Gladly. Any of these works."], signOff: "Best,", gaps: [] }) });
});

afterAll(async () => prisma().$disconnect());

describe("draftReplyJob", () => {
  it("offers the calendar's free times and saves the draft", async () => {
    const result = await draftReplyJob.run({ emailId: "e1", note: "", slots: null }, context);
    expect(result.slots).toEqual(["2026-10-20T08:00:00.000Z", "2026-10-21T12:00:00.000Z"]);
    const prompt = (provider.current as MockProvider).calls[0].messages[0].content;
    expect(prompt).toContain("• Tue 20 Oct, 10:00–10:45 (Europe/Berlin)");
    expect(prompt).toContain("The candidate wrote:\nI'm applying.");
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: "e1" } })).toMatchObject({ replyDraft: expect.stringContaining("Hi Anna,"), draftedWith: "draft-reply@2" });
  });

  it("offers only the times picked", async () => {
    const result = await draftReplyJob.run({ emailId: "e1", note: "shorter", slots: ["2026-10-21T12:00:00.000Z"] }, context);
    expect(result.slots).toEqual(["2026-10-21T12:00:00.000Z"]);
    const prompt = (provider.current as MockProvider).calls[0].messages[0].content;
    expect(prompt).toContain("Wed 21 Oct, 14:00–14:45");
    expect(prompt).not.toContain("Tue 20 Oct");
    expect(prompt).toContain("The candidate adds: shorter");
  });
});
