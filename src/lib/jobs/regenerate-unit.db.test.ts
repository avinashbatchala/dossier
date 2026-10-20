import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { regenerateUnitJob } from "./regenerate-unit";

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
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const units = demoResumeUnits();
const summary = units[0];
const where = { applicationId_kind: { applicationId: "app-1", kind: "RESUME" as const } };
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };
const input = { applicationId: "app-1", document: "RESUME" as const, unitId: "summary", from: summary.text };

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({
    data: {
      id: "app-1",
      company: "Ledgerly",
      role: "Senior Product Designer",
      language: "Dutch",
      postingText: "Ledgerly is hiring a Senior Product Designer.",
      documents: { create: [{ kind: "RESUME", units }] },
    },
  });
});
afterAll(() => prisma().$disconnect());

const savedSummary = async () => {
  const document = await prisma().document.findUniqueOrThrow({ where });
  return (document.units as typeof units)[0];
};

describe("regenerateUnitJob (E8-4)", () => {
  it("rewrites the unit and keeps the previous version for Undo", async () => {
    const mock = new MockProvider({ reply: () => ({ text: "Designer of calm, clear payment tools." }) });
    provider.current = mock;
    const result = await regenerateUnitJob.run(input, context);

    const rewritten = { ...summary, text: "Designer of calm, clear payment tools." };
    expect(result).toEqual({ outcome: "rewritten", previous: summary, unit: rewritten });
    expect(await savedSummary()).toEqual(rewritten);
    // A version of the document as rewritten (E8-10).
    expect(await prisma().documentVersion.findMany({ select: { cause: true, detail: true } })).toEqual([{ cause: "REGENERATED", detail: summary.label }]);
    // In the application's language, with the whole resume as context.
    const prompt = JSON.stringify(mock.calls[0]);
    expect(prompt).toMatch(/Dutch/);
    expect(prompt).toContain(units[1].text.split("\n")[0]);
  });

  it("marks what the profile and posting don't back", async () => {
    provider.current = new MockProvider({ reply: () => ({ text: "Cut support tickets by 40% at Stripe." }) });
    const result = await regenerateUnitJob.run(input, context);
    expect(result).toMatchObject({ outcome: "rewritten", unit: { unverified: expect.arrayContaining(["40%", "Stripe"]) } });
  });

  it("leaves a unit that changed before the rewrite started", async () => {
    const mock = new MockProvider({ reply: () => ({ text: "Never used" }) });
    provider.current = mock;
    expect(await regenerateUnitJob.run({ ...input, from: "An older text" }, context)).toEqual({ outcome: "changed" });
    expect(mock.calls).toHaveLength(0);
    expect(await savedSummary()).toEqual(summary);
  });

  it("leaves a unit edited while the AI was writing", async () => {
    provider.current = new MockProvider({
      reply: async () => {
        const document = await prisma().document.findUniqueOrThrow({ where });
        const edited = (document.units as typeof units).map((unit) => (unit.id === "summary" ? { ...unit, text: "Mine" } : unit));
        await prisma().document.update({ where, data: { units: edited } });
        return { text: "The AI's" };
      },
    });
    expect(await regenerateUnitJob.run(input, context)).toEqual({ outcome: "changed" });
    expect((await savedSummary()).text).toBe("Mine");
  });

  it("works from an application whose posting details are from an older version", async () => {
    await prisma().application.update({ where: { id: "app-1" }, data: { extracted: { requirements: ["Figma"] } } });
    provider.current = new MockProvider({ reply: () => ({ text: "Designer of calm tools." }) });
    expect(await regenerateUnitJob.run(input, context)).toMatchObject({ outcome: "rewritten" });
  });
});

describe("the letter's frame (E8-11)", () => {
  it("writes the greeting again in the letter's language, without the sender's contact details", async () => {
    const letter = [
      { id: "sender", label: "Sender", text: "Jane Doe\nsecret-mail@example.com" },
      { id: "greeting", label: "Greeting", text: "Dear Ledgerly team," },
      { id: "paragraph:1", label: "Opening", text: "Ik solliciteer graag." },
    ];
    await prisma().document.create({ data: { applicationId: "app-1", kind: "COVER_LETTER", units: letter } });
    const mock = new MockProvider({ reply: () => ({ text: "Beste Ledgerly-team," }) });
    provider.current = mock;
    const result = await regenerateUnitJob.run({ applicationId: "app-1", document: "COVER_LETTER", unitId: "greeting", from: "Dear Ledgerly team," }, context);
    // Not a claim about the candidate, so no fact-guard hints.
    expect(result).toMatchObject({ outcome: "rewritten", unit: { id: "greeting", text: "Beste Ledgerly-team," } });
    expect(result).not.toHaveProperty("unit.unverified");
    const prompt = JSON.stringify(mock.calls[0]);
    expect(prompt).not.toContain("secret-mail@example.com");
    expect(prompt).toMatch(/It's the letter's greeting/);
    expect(prompt).toMatch(/Dutch/);
  });
});
