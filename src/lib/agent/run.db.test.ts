import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import type { FoundPosting, SearchQuery } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { sweepFinishedJobs } from "@/lib/jobs/retention";
import { saveSettings, loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { MockProvider } from "../ai/providers/mock";

import { agentDedupeKey } from "./candidates";
import { runAgentScan } from "./run";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Drafts are their own jobs; here it's enough to see them queued.
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "draft-job"),
}));
// The sweep also removes old PDF zips, which isn't what's tested here.
vi.mock("@/lib/jobs/zip-pdfs", () => ({ removeOldZips: async () => {} }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});

// A fake source that counts its requests, and a fake AI that scores by title.
const fake = vi.hoisted(() => ({
  postings: [] as FoundPosting[],
  searches: 0,
  source: "JSEARCH" as "JSEARCH" | "ADZUNA" | null,
  ai: true,
  failOn: null as string | null,
  onScore: (() => {}) as (title: string) => void,
}));
vi.mock("@/lib/job-search", () => ({
  searchPostings: vi.fn(async () => {
    fake.searches += 1;
    return { postings: fake.postings, next: "page-2" };
  }),
}));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({
    source: fake.source,
    saved: true,
    jsearch: { key: "jsearch-key", host: "openwebninja", keyState: "set" },
    adzuna: { appId: "app", key: "adzuna-key", keyState: "set" },
  }),
  credentialsFor: () => ({ key: "jsearch-key", host: "openwebninja" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => fake.ai }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        const { title } = JSON.parse(call.messages[0].content.split("The posting's facts:\n")[1].split("\n\nThe posting:")[0]) as { title: string };
        fake.onScore(title);
        if (title === fake.failOn) return "not json at all";
        return { score: /senior/i.test(title) ? 90 : /designer/i.test(title) ? 75 : 40, reasons: [`Fits ${title}.`], redFlags: [] };
      },
    }),
}));

const prisma = () => db.client!;
const query: SearchQuery = { keywords: "Product designer", place: "Rotterdam", country: "nl", radiusKm: 25, remoteOnly: false, postedWithin: "any" };
const now = new Date("2026-10-20T08:00:00Z");
const hour = 60 * 60 * 1000;

const posting = (id: string, title: string, posted: string, extra: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "JSEARCH",
  externalId: id,
  title,
  company: `Company ${id}`,
  place: "Rotterdam",
  remote: false,
  salary: "",
  postedAt: posted,
  url: `https://jobs.example/${id}?utm_source=x`,
  via: "LinkedIn",
  description: `${title} at Company ${id}.`,
  complete: false,
  ...extra,
});
const page = [
  posting("a", "Senior Product Designer", "2026-10-19T00:00:00Z"),
  posting("b", "Product Designer", "2026-10-18T00:00:00Z"),
  // No link: its dedupe key is company, title and place.
  posting("c", "Office Manager", "2026-10-17T00:00:00Z", { url: "" }),
];

const context = (abort?: AbortController): JobContext & { steps: string[] } => {
  const steps: string[] = [];
  return { id: "agent-job", steps, step: async (name) => void steps.push(name), signal: (abort ?? new AbortController()).signal };
};

beforeEach(async () => {
  await resetDatabase(prisma());
  Object.assign(fake, { postings: page, searches: 0, source: "JSEARCH", ai: true, failOn: null, onScore: () => {} });
  await saveSettings({ agentEnabled: true, agentQuery: query });
});
afterAll(() => prisma().$disconnect());

describe("runAgentScan (E16-3)", () => {
  it("searches once, scores the new postings and keeps them, below the minimum too", async () => {
    const run = context();
    const result = await runAgentScan({ manual: false }, run, now);
    expect(fake.searches).toBe(1);
    expect(run.steps).toEqual(["Searching for new postings", "Scoring 3 postings"]);
    expect(result).toEqual({ found: 3, fresh: 3, scored: 3, drafted: 0, skipped: 0, message: "2 new postings are waiting for a look." });
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { score: "desc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.score, candidate.status])).toEqual([
      ["a", 90, "SCORED"],
      ["b", 75, "SCORED"],
      ["c", 40, "SCORED"],
    ]);
    expect(candidates[0]).toMatchObject({ title: "Senior Product Designer", reasons: ["Fits Senior Product Designer."], dedupeKey: agentDedupeKey(page[0]) });
    // Find jobs shows the scores too (#208).
    expect((await prisma().postingScore.findMany({ orderBy: { score: "desc" } })).map((row) => [row.externalId, row.score])).toEqual([["a", 90], ["b", 75], ["c", 40]]);
    // The run is on record, with how it ended.
    expect((await loadSettings()).agentRuns).toEqual([{ at: now.toISOString(), manual: false, message: "2 new postings are waiting for a look." }]);
  });

  it("scores the newest new postings first, up to the cap", async () => {
    await saveSettings({ agentMaxScores: 2 });
    const scoredTitles: string[] = [];
    fake.onScore = (title) => scoredTitles.push(title);
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(scoredTitles).toEqual(["Senior Product Designer", "Product Designer"]);
    expect(result).toMatchObject({ fresh: 3, scored: 2 });
  });

  it("never brings back what it has seen, from another run or another source", async () => {
    await runAgentScan({ manual: false }, context(), now);
    const again = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(again).toEqual({ found: 3, fresh: 0, scored: 0, drafted: 0, skipped: 3, message: "No new postings this time." });

    // The same jobs from Adzuna: one by its link, one by company, title and place.
    fake.postings = [
      posting("az-1", "Senior Product Designer", "2026-10-19T00:00:00Z", { source: "ADZUNA", url: "https://jobs.example/a?utm_medium=y" }),
      posting("az-2", "Office  Manager", "2026-10-18T00:00:00Z", { source: "ADZUNA", url: "", company: "COMPANY c" }),
      posting("az-3", "Brand Designer", "2026-10-20T00:00:00Z", { source: "ADZUNA" }),
    ];
    const third = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 4 * hour));
    expect(third).toMatchObject({ found: 3, fresh: 1, scored: 1, skipped: 2 });
  });

  it("leaves out postings saved, dismissed or applied for in Find jobs", async () => {
    const application = await prisma().application.create({ data: {} });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "a", savedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "b", dismissedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "c", applicationId: application.id } });
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 3, fresh: 0, skipped: 3 });
    expect(await prisma().agentCandidate.count()).toBe(0);
  });

  it("stops without asking the source when it's off, not set up, or has run 3 times in 24 hours", async () => {
    const stop = async (manual = false) => (await runAgentScan({ manual }, context(), now)).message;
    await saveSettings({ agentEnabled: false });
    expect(await stop()).toBe("The job agent is off.");
    await saveSettings({ agentEnabled: true, agentQuery: { ...query, keywords: " " } });
    expect(await stop()).toBe("Add what to look for in Settings → Job agent first.");
    await saveSettings({ agentQuery: { ...query, country: "" } });
    expect(await stop()).toBe("Choose a country for the search in Settings → Job agent first.");
    await saveSettings({ agentQuery: query });
    fake.ai = false;
    expect(await stop()).toBe("Choose an AI provider in Settings → AI provider first.");
    fake.ai = true;
    fake.source = null;
    expect(await stop()).toBe("Choose a job source in Settings → Job search first.");
    fake.source = "JSEARCH";
    expect(fake.searches).toBe(0);
    expect((await loadSettings()).agentRuns).toEqual([]);
  });

  it("holds the daily limit from its own record, whatever the task-data sweep deletes", async () => {
    await saveSettings({ jobRetentionHours: 1 });
    for (const hours of [0, 2, 4]) {
      // Each run's Job row, as the runner leaves it, which the sweep deletes an hour later.
      const at = new Date(now.getTime() + hours * hour);
      await prisma().job.create({ data: { type: "agent-scan", key: "agent", status: "DONE", input: { manual: true }, finishedAt: at } });
      await runAgentScan({ manual: true }, context(), at);
      await sweepFinishedJobs(new Date(now.getTime() + (hours + 1.5) * hour));
    }
    expect(fake.searches).toBe(3);
    expect(await prisma().job.count()).toBe(0);
    const fourth = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 6 * hour));
    expect(fourth.message).toBe("The agent has run 3 times in the past 24 hours, as many as it may. Try again in 18 hours.");
    expect(fake.searches).toBe(3);
    // A day after the first, one may go again.
    await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 24 * hour + 1));
    expect(fake.searches).toBe(4);
  });

  it("records the run before it asks the source, so a failing source still counts", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    vi.mocked(searchPostings).mockRejectedValueOnce(new Error("socket hang up"));
    await expect(runAgentScan({ manual: false }, context(), now)).rejects.toThrow("socket hang up");
    expect((await loadSettings()).agentRuns).toEqual([{ at: now.toISOString(), manual: false, message: null }]);
  });

  it("goes on when one score fails, and says what failed when none worked", async () => {
    fake.failOn = "Product Designer";
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ scored: 2 });
    expect((await prisma().agentCandidate.findMany()).map((candidate) => candidate.externalId).sort()).toEqual(["a", "c"]);

    await prisma().agentCandidate.deleteMany();
    fake.postings = [page[1]];
    const failed = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(failed).toMatchObject({ scored: 0, message: "The model's answer didn't come back in the expected shape. Try again." });
  });

  it("stops between postings when it's cancelled", async () => {
    const abort = new AbortController();
    fake.onScore = () => abort.abort();
    const result = await runAgentScan({ manual: false }, context(abort), now);
    expect(result.scored).toBeLessThanOrEqual(1);
    expect(await prisma().agentCandidate.count()).toBeLessThanOrEqual(1);
  });

  it("queues drafts for the best new postings when auto-draft is on, up to the cap (#197)", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    vi.mocked(startJob).mockClear();
    expect((await runAgentScan({ manual: false }, context(), now)).drafted).toBe(0);
    expect(startJob).not.toHaveBeenCalled();

    await prisma().agentCandidate.deleteMany();
    await saveSettings({ agentAutoDraft: true, agentMaxDrafts: 1 });
    const result = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(result).toMatchObject({ scored: 3, drafted: 1, message: "2 new postings are waiting for a look. Preparing a draft for the best one." });
    const best = await prisma().agentCandidate.findFirstOrThrow({ where: { externalId: "a" } });
    expect(startJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: best.id }, { key: `agent-candidate:${best.id}` });
  });

  it("says when nothing reached the minimum score", async () => {
    fake.postings = [page[2]];
    expect((await runAgentScan({ manual: false }, context(), now)).message).toBe("Scored 1 new posting; none reached your minimum score of 70.");
    expect(demoProfile().basics.name).toBe("Jane Doe");
  });
});
