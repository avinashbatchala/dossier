import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { writeMessageJob } from "./write-message";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/frozen-copy", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { profileOfApplication: async () => demoProfile() };
});
vi.mock("@/lib/profile-data", () => ({ loadFactTexts: async () => [] }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "UTC" }));
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({
    data: {
      id: "app-1",
      profileId: TEST_PROFILE_ID,
      company: "Ledgerly",
      role: "Designer",
      salary: "€75,000–€90,000",
      language: "English",
      status: "SENT",
      sentAt: new Date("2026-11-02T10:00:00Z"),
      offer: { create: { salary: "€82,000" } },
      documents: { create: [{ kind: "EMAIL", units: [{ id: "to", label: "Recipient", text: "careers@ledgerly.example" }, { id: "subject", label: "Subject", text: "Application" }, { id: "body", label: "Message", text: "Hi" }] }] },
    },
  });
});
afterAll(() => prisma().$disconnect());

describe("writeMessageJob (E30-7, E30-8)", () => {
  it("drafts a follow-up to whoever the email went to, with when it was sent", async () => {
    const mock = new MockProvider({ reply: () => ({ subject: " Following up ", body: " Hi there. " }) });
    provider.current = mock;
    const draft = await writeMessageJob.run({ applicationId: "app-1", kind: "follow-up" }, context);
    expect(draft).toMatchObject({ kind: "follow-up", to: "careers@ledgerly.example", subject: "Following up", body: "Hi there.", writtenWith: "write-message@1" });
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).messageDraft).toEqual(draft);
    const sent = JSON.stringify(mock.calls[0]);
    expect(sent).toContain("The application was sent Mon 2 Nov.");
    expect(sent).not.toContain("The offer:");
  });

  it("asks for more with the offer and the posted range", async () => {
    const mock = new MockProvider({ reply: () => ({ subject: "Re: Offer", body: "Thank you." }) });
    provider.current = mock;
    await writeMessageJob.run({ applicationId: "app-1", kind: "more" }, context);
    const sent = JSON.stringify(mock.calls[0]);
    expect(sent).toContain("The offer: salary €82,000. The posting said: €75,000–€90,000.");
    expect(sent).toMatch(/Never threaten or invent other offers/);
  });
});
