import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { loadDemand } from "./demand";
import { saveProfileSettings } from "./profiles";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const now = new Date("2026-11-17T10:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
type Line = [skill: string | null, covered: boolean];
const breakdown = (...lines: Line[]) => ({
  factors: [],
  cap: null,
  requirements: lines.map(([skill, covered], index) => ({ text: `Line ${index}`, mustHave: true, covered, evidence: null, skill })),
});

/** A posting, saved or applied for, scored for a profile `days` ago. */
async function scored(externalId: string, company: string, lines: Line[], { days = 1, profileId = TEST_PROFILE_ID, saved = true, applicationId = null as string | null } = {}) {
  await prisma().posting.create({ data: { source: "JSEARCH", externalId, company, savedAt: saved ? daysAgo(days) : null, applicationId } });
  await prisma().postingScore.create({
    data: { source: "JSEARCH", externalId, profileId, score: 70, reasons: [], redFlags: [], scoredWith: "score-posting@3", breakdown: breakdown(...lines), updatedAt: daysAgo(days) },
  });
}

const counts = async (profileId = TEST_PROFILE_ID) => (await loadDemand(profileId, now)).items.map(({ name, count, coveredVotes, gapVotes }) => [name, count, coveredVotes, gapVotes]);

describe("loadDemand (E33-3)", () => {
  it("counts saved and applied-for postings scored for the profile in the last 90 days, a skill once a posting", async () => {
    await scored("a", "Ledgerly", [["Kubernetes", false], ["k8s", false], ["Figma", true], [null, true]]);
    await scored("b", "Adyen", [["Kubernetes", false]], { days: 89 });
    await scored("old", "Old", [["Kubernetes", false]], { days: 91 });
    await prisma().profile.create({ data: { id: "second", name: "Second" } });
    await scored("other", "Other", [["Kubernetes", false]], { profileId: "second" });
    // Neither saved nor applied for.
    await scored("seen", "Seen", [["Kubernetes", false]], { saved: false });

    const demand = await loadDemand(TEST_PROFILE_ID, now);
    expect(demand.postings).toBe(2);
    expect(await counts()).toEqual([
      ["Kubernetes", 2, 0, 2],
      ["Figma", 1, 1, 0],
    ]);
    expect(demand.items[0].companies).toEqual(["Ledgerly", "Adyen"]);
  });

  it("counts the profile's applications too, once when they came from a counted posting, and hides what was marked as not had", async () => {
    const application = await prisma().application.create({
      data: {
        profileId: null,
        company: "Finch Ledger",
        createdAt: daysAgo(2),
        match: { items: [{ requirement: "Payments experience", result: "gap", skill: null, experienceIds: [], note: null, mustHave: true, addable: "Payments" }] },
        extracted: {
          title: null, company: null, role: null, location: null, mode: null, salary: null, deadline: null, asksForReferences: false, language: null,
          requirements: [{ text: "Kubernetes", kind: "skill", skill: "Kubernetes", years: null, language: null }],
        },
      },
    });
    const fromPosting = await prisma().application.create({ data: { profileId: TEST_PROFILE_ID, company: "Ledgerly", match: { items: [] } } });
    await scored("a", "Ledgerly", [["Figma", true]], { saved: false, applicationId: fromPosting.id });
    // An agent draft isn't applied for yet.
    await prisma().application.create({ data: { profileId: TEST_PROFILE_ID, awaitingReview: true, extracted: { requirements: [{ text: "Go", kind: "skill", skill: "Go", years: null, language: null }] } } });

    expect(await counts()).toEqual([
      ["Figma", 1, 1, 0],
      ["Kubernetes", 1, 0, 0],
      ["Payments", 1, 0, 1],
    ]);
    expect((await loadDemand(TEST_PROFILE_ID, now)).hidden).toEqual([]);

    await prisma().knownGap.create({ data: { applicationId: application.id, requirement: "Payments experience" } });
    await saveProfileSettings(TEST_PROFILE_ID, { gapsDismissed: ["kubernetes"] });
    expect((await loadDemand(TEST_PROFILE_ID, now)).hidden.toSorted()).toEqual(["kubernetes", "payments"]);
  });
});
