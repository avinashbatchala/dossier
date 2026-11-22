import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { fillCandidateCoverage } from "./fill-coverage";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

const breakdown = (hit: number, total: number, must = false) => ({
  factors: [],
  cap: null,
  requirements: Array.from({ length: total }, (_, index) => ({ text: `R${index}`, mustHave: must, covered: index < hit, evidence: null })),
});
const candidate = (externalId: string) => prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId, dedupeKey: externalId, score: 80 } });

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("fillCandidateCoverage (E32-2)", () => {
  it("gives candidates from before coverage the best of their kept scores, once", async () => {
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1 } });
    await candidate("a");
    await candidate("b");
    await prisma().postingScore.createMany({
      data: [
        { source: "JSEARCH", externalId: "a", profileId: TEST_PROFILE_ID, score: 90, reasons: [], redFlags: [], scoredWith: "test", breakdown: breakdown(1, 3, true) },
        { source: "JSEARCH", externalId: "a", profileId: backend.id, score: 40, reasons: [], redFlags: [], scoredWith: "test", breakdown: breakdown(3, 3, true) },
        // Scored before breakdowns: nothing to count.
        { source: "JSEARCH", externalId: "b", profileId: TEST_PROFILE_ID, score: 70, reasons: [], redFlags: [], scoredWith: "test" },
      ],
    });
    expect(await fillCandidateCoverage()).toBe(1);
    expect(await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" }, select: { externalId: true, covered: true, requirements: true, mustMissing: true } })).toEqual([
      { externalId: "a", covered: 3, requirements: 3, mustMissing: 0 },
      { externalId: "b", covered: 0, requirements: 0, mustMissing: 0 },
    ]);
    expect(await fillCandidateCoverage()).toBe(0);
  });
});
