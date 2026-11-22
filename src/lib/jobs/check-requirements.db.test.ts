import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { checkRequirementsJob } from "./check-requirements";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const scorer = vi.hoisted(() => ({
  calls: [] as { posting: unknown; profileId: unknown }[],
  requirements: [] as { text: string; mustHave: boolean; covered: boolean; evidence: string | null; skill?: string | null }[],
}));
vi.mock("@/lib/scoring", () => ({
  loadPostingScorer: async () => async (posting: unknown, profile: { profileId: unknown }) => {
    scorer.calls.push({ posting, profileId: profile.profileId });
    return { data: { score: 0, reasons: [], redFlags: [], breakdown: { factors: [], cap: null, requirements: scorer.requirements } }, scoredWith: "score-posting-jev@2" };
  },
  // The profile as it is now, by its id.
  loadScoringProfile: async (profileId: string) => ({ profileId }),
}));
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };
const oldMatch = { items: [{ requirement: "Figma", result: "gap", skill: null, experienceIds: [], note: null }] };

beforeEach(async () => {
  await resetDatabase(prisma());
  scorer.calls = [];
  scorer.requirements = [
    { text: "Figma", mustHave: true, covered: true, evidence: "At Fieldnote", skill: "Figma" },
    { text: "Payments", mustHave: false, covered: false, evidence: null, skill: "Payments" },
  ];
  const { id: profileId } = await prisma().profile.findFirstOrThrow();
  await prisma().application.create({
    data: { id: "app-1", profileId, company: "Ledgerly", role: "Designer", location: "Amsterdam", mode: "Remote", postingText: "Ledgerly is hiring a Designer.", match: oldMatch, matchedWith: "match-requirements@1" },
  });
  await prisma().application.create({ data: { id: "app-2", profileId, company: "Acme", postingText: " " } });
});
afterAll(() => prisma().$disconnect());

describe("checkRequirementsJob (E30-1)", () => {
  it("checks the posting against the profile as it is now and keeps the new match", async () => {
    const match = await checkRequirementsJob.run({ applicationId: "app-1" }, context);
    expect(match.items.map((item) => [item.requirement, item.result])).toEqual([
      ["Figma", "covered"],
      ["Payments", "gap"],
    ]);
    const { profileId } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    expect(scorer.calls).toEqual([
      { posting: { title: "Designer", company: "Ledgerly", place: "Amsterdam", remote: true, salary: "", description: "Ledgerly is hiring a Designer." }, profileId },
    ]);
    const saved = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    expect(saved.match).toEqual(match);
    expect(saved.matchedWith).toBe("score-posting-jev@2");
  });

  it("keeps the old match when the check finds no requirements", async () => {
    scorer.requirements = [];
    await expect(checkRequirementsJob.run({ applicationId: "app-1" }, context)).rejects.toThrow("the last one stays");
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).match).toEqual(oldMatch);
  });

  it("says so for an application without a posting", async () => {
    await expect(checkRequirementsJob.run({ applicationId: "app-2" }, context)).rejects.toThrow("no posting");
    expect(scorer.calls).toEqual([]);
  });
});
