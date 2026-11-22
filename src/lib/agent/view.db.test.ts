import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { countAgentQueue, loadAgentView } from "./view";
import { withAgentScanLock } from "./scan-lock";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("./scan-lock", async (original) => {
  const actual = await original<typeof import("./scan-lock")>();
  const { testDatabaseUrl } = await import("@/test/db");
  return { ...actual, withAgentScanLock: <T>(work: (signal: AbortSignal) => Promise<T>) => actual.withAgentScanLock(work, testDatabaseUrl()) };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ saved: true, freehire: { url: "https://freehire.me" }, portals: [{ id: "JSEARCH", on: true, offered: true, fields: {}, keys: {}, acceptedAt: null }] }),
  enabledPortals: (config: { portals: { id: string; on: boolean }[] }) => config.portals.filter((portal) => portal.on).map((portal) => portal.id),
  agentPortal: (config: { portals: { id: string; on: boolean }[] }) => config.portals.find((portal) => portal.on && portal.id !== "ARBEITSAGENTUR")?.id ?? null,
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
}));

const prisma = () => db.client!;
const now = new Date("2026-10-20T10:00:00Z");
const candidate = (externalId: string, score: number, data: Record<string, unknown> = {}) =>
  prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId, dedupeKey: externalId, title: `Posting ${externalId}`, company: "Ledgerly", place: "Berlin", remote: true, score, via: "LinkedIn", postedAt: new Date("2026-10-18T00:00:00Z"), ...data } });

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().agentSearch.create({ data: { name: "My search", query: { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" } } });
  await saveSettings({
    agentEnabled: true,
    agentRuns: [{ at: "2026-10-20T05:00:00Z", manual: false, message: "2 new postings are waiting for a look." }],
  });
});
afterAll(() => prisma().$disconnect());

describe("the Agent screen's data (E16-6)", () => {
  it("links missing Jev credentials to Settings → Scoring", async () => {
    await saveSettings({ scorer: "JEV" });
    expect(await loadAgentView(now)).toMatchObject({ setupSection: "scoring", setupProblem: "Enter your TypeSafe key in Settings → Scoring first." });
  });

  it("finds each search's latest retained outcome even when absent from the last batch, formatting quota in the user's zone", async () => {
    const first = await prisma().agentSearch.findFirstOrThrow();
    const second = await prisma().agentSearch.create({ data: { name: "Disabled", query: first.query!, enabled: false, sort: 1 } });
    const result = { searchId: second.id, searchName: "Old name", found: 7, fresh: 2, error: null };
    await saveSettings({ agentRuns: [
      { at: "2026-10-20T09:00:00Z", manual: true, message: "Failed", sourceRequests: 2, searches: [{ ...result, searchId: first.id, error: "Offline" }] },
      { at: "2026-10-20T05:00:00Z", manual: false, message: "Done", sourceRequests: 1, searches: [result] },
    ] });
    expect(await loadAgentView(now)).toMatchObject({
      budget: [{ portal: "JSEARCH", name: "JSearch", used: 3 }], nextEligibility: "Wed 21 Oct, 07:00", timeZone: "Europe/Berlin", limitReached: true,
      searchHistory: [expect.objectContaining({ searchId: first.id, error: "Offline", at: "Tue 20 Oct, 11:00" }), { ...result, at: "Tue 20 Oct, 07:00" }],
    });
  });

  it("surfaces interrupted runs and their conservative budget cost before another scan can run", async () => {
    await saveSettings({ agentRuns: [{ at: now.toISOString(), manual: false, message: null, sourceRequests: 3 }] });
    const view = await loadAgentView(now);
    expect(view.lastRun?.message).toContain("interrupted");
    expect(view.lastRun?.message).toContain("All 3 reserved source requests still count");
    expect(view.lastRun?.message).toContain("including any not sent");
    expect(view.budget).toEqual([{ portal: "JSEARCH", name: "JSearch", used: 3 }]);
    expect(view.limitReached).toBe(true);
    // Rendering must not take execution ownership or mutate its ledger.
    expect((await prisma().setting.findUniqueOrThrow({ where: { key: "agentRuns" } })).value).toContain('"message":null');
  });

  it("keeps a queued scan pending without competing for execution ownership", async () => {
    await saveSettings({ agentRuns: [{ at: now.toISOString(), manual: false, message: null, sourceRequests: 2 }] });
    const job = await prisma().job.create({ data: { type: "agent-scan", key: "agent", input: { manual: true } } });
    expect(await loadAgentView(now)).toMatchObject({ runJobId: job.id, lastRun: { message: null } });
  });

  it("doesn't reconcile a live scan when the screen is opened", async () => {
    await saveSettings({ agentRuns: [{ at: now.toISOString(), manual: false, message: null, sourceRequests: 2 }] });
    await withAgentScanLock(async () => {
      expect((await loadAgentView(now)).lastRun?.message).toBeNull();
    });
  });
  it("shows the drafts to review, and counts what waits in Positions (E22-8)", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    await candidate("draft", 90, { status: "DRAFTED", applicationId: application.id });
    // What waits goes by coverage (E32-2): two thirds or more, from the 0–100 minimum of 70.
    const good = await candidate("good", 75, { covered: 2, requirements: 3 });
    const search = await prisma().agentSearch.findFirstOrThrow();
    await prisma().agentCandidateSearch.create({ data: { candidateId: good.id, searchId: search.id, searchName: "Original search name" } });
    await candidate("better", 88, { covered: 3, requirements: 3 });
    await candidate("low", 30, { covered: 1, requirements: 3 });
    await candidate("gone", 95, { status: "DISMISSED" });
    await candidate("kept", 95, { status: "APPROVED" });
    await candidate("unscored", 0, { skipReason: "budget" });

    const view = await loadAgentView(now);
    // Best finds, best fit first, and what it skipped, with why (E32-5).
    expect(view.finds.map((entry) => entry.title)).toEqual(["Posting better", "Posting good"]);
    expect(view.skipped.map((entry) => [entry.title, entry.why])).toEqual(
      expect.arrayContaining([
        ["Posting low", "Covers 1 of 3: under your cut-off (at least two thirds)"],
        ["Posting unscored", "Past the run's scoring limit: it stays in Positions unscored"],
      ]),
    );
    expect(view.skipped).toHaveLength(2);
    expect(view.drafts.map((entry) => entry.title)).toEqual(["Posting draft"]);
    expect(view.drafts[0]).toMatchObject({ facts: "Berlin · Remote", origin: "Posted 2 days ago · via LinkedIn on JSearch", applicationId: application.id });
    expect(view).toMatchObject({
      waiting: 2,
      searches: [expect.objectContaining({ id: search.id, enabled: true })],
      budget: [{ portal: "JSEARCH", name: "JSearch", used: 1 }],
      nextEligibility: "Now",
      setupProblem: null,
      limitReached: false,
      lastRun: { at: "Tue 20 Oct, 07:00", message: "2 new postings are waiting for a look." },
      nextRun: "Wed 21 Oct, 07:00",
    });
    // The badge: drafts to review; what's scored waits in Positions.
    expect(await countAgentQueue()).toBe(1);
  });

  it("says what's missing, and when the day's runs are used up", async () => {
    await prisma().agentSearch.deleteMany();
    await saveSettings({
      agentEnabled: false,
      agentRuns: ["09:30", "08:00", "06:00"].map((time) => ({ at: `2026-10-20T${time}:00Z`, manual: true, message: null })),
    });
    expect(await loadAgentView(now)).toMatchObject({
      enabled: false,
      setupProblem: "Add what to look for in Settings → Job agent first.",
      setupSection: "agent",
      limitReached: true,
      nextRun: null,
    });
  });
});
