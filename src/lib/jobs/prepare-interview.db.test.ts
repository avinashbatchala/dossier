import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { prepareInterviewJob } from "./prepare-interview";

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
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({
    data: { id: "app-1", profileId: TEST_PROFILE_ID, company: "Ledgerly", role: "Designer", language: "English", postingText: "Ledgerly is hiring.", interviews: { create: { id: "i1", round: 2, minutes: 45, people: "Lotte de Vries" } } },
  });
});
afterAll(() => prisma().$disconnect());

describe("prepareInterviewJob (E30-6)", () => {
  it("keeps the checklist on the round, unticked", async () => {
    const mock = new MockProvider({ reply: () => ({ items: [{ text: "Reread the posting", why: "From the posting" }, { text: "Questions for Lotte", why: "For the people you'll meet" }] }) });
    provider.current = mock;
    const prep = await prepareInterviewJob.run({ applicationId: "app-1", interviewId: "i1" }, context);
    expect(prep).toEqual([
      { text: "Reread the posting", why: "From the posting", done: false },
      { text: "Questions for Lotte", why: "For the people you'll meet", done: false },
    ]);
    expect(await prisma().interview.findUniqueOrThrow({ where: { id: "i1" } })).toMatchObject({ prep, prepWrittenWith: "prepare-interview@1" });
    expect(JSON.stringify(mock.calls[0])).toContain("round 2, 45 minutes, with Lotte de Vries");
  });

  it("refuses a round of another application", async () => {
    await prisma().application.create({ data: { id: "app-2", company: "Acme" } });
    provider.current = new MockProvider({ reply: () => ({ items: [] }) });
    await expect(prepareInterviewJob.run({ applicationId: "app-2", interviewId: "i1" }, context)).rejects.toThrow();
  });
});
