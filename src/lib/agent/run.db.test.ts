import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { demoProfile } from "@/lib/demo-profile";
import { DEFAULT_FILTERS, FOUND_BY_AGENT, type FoundPosting, type SearchQuery } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { sweepFinishedJobs } from "@/lib/jobs/retention";
import { encryptSecret, TYPESAFE_KEY } from "@/lib/secrets";
import { saveSettings, loadSettings } from "@/lib/settings-data";
import { loadProfile } from "@/lib/profile-data";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { MockProvider } from "../ai/providers/mock";

import { listLibrary } from "../library";
import { listSearches } from "../posting-searches";

import { agentDedupeKey, candidateData } from "./candidates";
import { runAgentScan } from "./run";
import { saveAgentSearch, listAgentSearches } from "./searches";
import { reserveRun } from "./runs";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("./scan-lock", async (original) => {
  const { withAgentScanLock } = await original<typeof import("./scan-lock")>();
  const { testDatabaseUrl } = await import("@/test/db");
  return { withAgentScanLock: <T>(work: (signal: AbortSignal) => Promise<T>) => withAgentScanLock(work, testDatabaseUrl()) };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
// Drafts are their own jobs; here it's enough to see them queued.
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "draft-job"),
}));
// Notifications (E26-4): which events were emitted, and with what.
vi.mock("@/lib/notifications/notify", () => ({ emit: vi.fn(async () => 0) }));
// The sweep also removes old PDF zips, which isn't what's tested here.
vi.mock("@/lib/jobs/zip-pdfs", () => ({ removeOldZips: async () => {} }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: vi.fn(async () => demoProfile()) };
});

// A fake source that counts its requests, and a fake AI that scores by title.
const fake = vi.hoisted(() => ({
  postings: [] as FoundPosting[],
  searches: 0,
  source: "JSEARCH" as "JSEARCH" | "ADZUNA" | "FREEHIRE" | "ARBEITSAGENTUR" | null,
  /** More portals switched on, after `source` (E22-8). */
  extra: [] as ("JSEARCH" | "ADZUNA" | "FREEHIRE" | "ARBEITSAGENTUR")[],
  ai: true,
  failOn: null as string | null,
  onScore: (() => {}) as (title: string) => void,
}));
vi.mock("@/lib/job-search", () => ({
  // Each portal gives the same postings as its own.
  searchPostings: vi.fn(async (source: string) => {
    fake.searches += 1;
    return { postings: fake.postings.map((posting) => (fake.extra.length > 0 ? { ...posting, source } : posting)), next: "page-2" };
  }),
}));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: vi.fn(async () => ({
    saved: true,
    freehire: { url: "https://freehire.me" },
    portals: [...(fake.source ? [fake.source] : []), ...fake.extra].map((id) => ({ id, on: true, offered: true, fields: {}, keys: {}, acceptedAt: null })),
  })),
  enabledPortals: (config: { portals: { id: string; on: boolean }[] }) => config.portals.filter((portal) => portal.on).map((portal) => portal.id),
  agentPortal: (config: { portals: { id: string; on: boolean }[] }) => config.portals.find((portal) => portal.on && portal.id !== "ARBEITSAGENTUR")?.id ?? null,
  credentialsFor: () => ({ key: "jsearch-key", host: "openwebninja" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => fake.ai }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: async (call) => {
        const { factorsAnswer, scoredPosting } = await import("@/test/scoring");
        const { title } = scoredPosting(call);
        fake.onScore(title);
        if (title === fake.failOn) return "not json at all";
        // 100, 71 or 8 (E25).
        return factorsAnswer(call, /senior/i.test(title) ? "high" : /designer/i.test(title) ? "mid" : "low");
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
  Object.assign(fake, { postings: page, searches: 0, source: "JSEARCH", extra: [], ai: true, failOn: null, onScore: () => {} });
  await saveSettings({ agentEnabled: true });
  await prisma().agentSearch.create({ data: { name: "My search", query } });
});
afterAll(() => prisma().$disconnect());

describe("runAgentScan (E16-3)", () => {
  it("runs recurring searches with FreeHire under the same request budget", async () => {
    fake.source = "FREEHIRE";
    fake.postings = page.map((posting) => ({ ...posting, source: "FREEHIRE" }));
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 3, scored: 3 });
    expect((await loadSettings()).agentRuns[0].sourceRequests).toBe(1);
    expect(await prisma().agentCandidate.count({ where: { source: "FREEHIRE" } })).toBe(3);
  });

  it.each(["ARBEITSAGENTUR", null] as const)("uses its validated source snapshot despite a concurrent switch to %s", async (source) => {
    const { loadJobSearchConfig } = await import("@/lib/job-search/config");
    const original = vi.mocked(loadJobSearchConfig).getMockImplementation()!;
    vi.mocked(loadJobSearchConfig).mockClear();
    vi.mocked(loadJobSearchConfig).mockImplementationOnce(async () => {
      const config = await original();
      fake.source = source;
      return config;
    });
    expect((await runAgentScan({ manual: false }, context(), now)).scored).toBe(3);
    // The portals it asks are the snapshot's (E22-8).
    expect((await loadSettings()).agentRuns[0].sourceRequestPortals).toEqual(["JSEARCH"]);
    expect(fake.searches).toBe(1);
    expect((await loadSettings()).agentRuns[0].sourceRequests).toBe(1);
  });

  it("distinguishes an all-disabled collection from no searches without consuming budget", async () => {
    await prisma().agentSearch.updateMany({ data: { enabled: false } });
    expect((await runAgentScan({ manual: true }, context(), now)).message).toBe("Enable an Agent search in Settings → Job agent first.");
    expect((await loadSettings()).agentRuns).toEqual([]);
    expect(fake.searches).toBe(0);
  });

  it("reconciles a crashed scan only after acquiring scan ownership, even when admission is refused", async () => {
    await reserveRun(now, false, ["JSEARCH", "JSEARCH", "JSEARCH"]);
    const result = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + hour));
    expect(result.message).toContain("needs 1 request to JSearch");
    const runs = (await loadSettings()).agentRuns;
    expect(runs).toHaveLength(1);
    expect(runs[0].message).toContain("interrupted");
    expect(runs[0].sourceRequests).toBe(3);
    expect(fake.searches).toBe(0);
  });
  it("collects ordered searches sequentially, fairly scores unique candidates and shares the draft cap", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    const [first] = await listAgentSearches();
    const second = await saveAgentSearch({ name: "Second", query: { ...query, keywords: "Second query" }, sort: 1, enabled: true });
    await saveAgentSearch({ name: "Disabled", query, sort: 2, enabled: false });
    const shared = page[0];
    const secondNew = posting("second", "Senior Second Designer", "2026-10-18T12:00:00Z");
    vi.mocked(searchPostings).mockImplementationOnce(async (_source, _credentials, q, cursor) => {
      expect(q).toEqual(query);
      expect(cursor).toBeNull();
      fake.searches++;
      await Promise.resolve();
      expect(fake.searches).toBe(1); // A parallel second dispatch would already have incremented it.
      return { postings: [page[2], shared, page[1]], next: "page-2" };
    }).mockImplementationOnce(async (_source, _credentials, q, cursor) => {
      expect(q.keywords).toBe("Second query");
      expect(cursor).toBeNull();
      fake.searches++;
      return { postings: [secondNew, shared], next: "page-2" };
    });
    const scores: string[] = [];
    fake.onScore = (title) => { expect(fake.searches).toBe(2); scores.push(title); };
    await saveSettings({ agentMaxScores: 3, agentAutoDraft: true, agentMaxDrafts: 1 });
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(scores).toEqual([shared.title, secondNew.title, page[1].title]);
    expect(result).toMatchObject({ found: 5, fresh: 4, scored: 3, drafted: 1, skipped: 1 });
    const candidate = await prisma().agentCandidate.findUniqueOrThrow({ where: { dedupeKey: agentDedupeKey(shared) } });
    expect((await prisma().agentCandidateSearch.findMany({ where: { candidateId: candidate.id } })).map((link) => link.searchId).sort()).toEqual([first.id, second.id].sort());
    expect((await loadSettings()).agentRuns[0]).toMatchObject({ sourceRequests: 2, searches: [{ searchName: "My search", found: 3, fresh: 3 }, { searchName: "Second", found: 2, fresh: 2 }] });
  });

  it("continues after an individual source error and keeps its durable result", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    await saveAgentSearch({ name: "Second", query, sort: 1, enabled: true });
    vi.mocked(searchPostings).mockRejectedValueOnce(new Error("socket hang up"));
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result.scored).toBe(3);
    expect(result.message).toContain("My search: JSearch: The portal couldn't be reached. Try again.");
    expect((await loadSettings()).agentRuns[0]).toMatchObject({ sourceRequests: 2, searches: [{ found: 0, fresh: 0, error: expect.any(String) }, { found: 3, fresh: 3, error: null }] });
    expect((await runAgentScan({ manual: true }, context(), new Date(now.getTime() + hour))).message).toContain("needs 2 requests to JSearch");
  });

  it("keeps source collection success separate from model failure, without inventing candidate attribution", async () => {
    await saveAgentSearch({ name: "Overlap", query, sort: 1, enabled: true });
    fake.postings = [page[1]];
    fake.failOn = page[1].title;
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 2, fresh: 1, scored: 0, drafted: 0, message: "The model's answer didn't come back in the expected shape. Try again." });
    const run = (await loadSettings()).agentRuns[0];
    expect(run).toMatchObject({ sourceRequests: 2, message: result.message, searches: [
      { searchName: "My search", found: 1, fresh: 1, error: null },
      { searchName: "Overlap", found: 1, fresh: 1, error: null },
    ] });
    expect(await prisma().agentCandidate.count()).toBe(0);
    expect(await prisma().agentCandidateSearch.count()).toBe(0);
    expect((await runAgentScan({ manual: true }, context(), new Date(now.getTime() + hour))).message).toContain("needs 2 requests to JSearch");
    expect(fake.searches).toBe(2);
  });

  it("attributes existing candidates before dedupe, without restoring dismissed or Find jobs exclusions", async () => {
    const kept = await prisma().agentCandidate.create({ data: candidateData(page[0], { score: 90, reasons: [], redFlags: [] }) });
    const dismissed = await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "b", dedupeKey: agentDedupeKey(page[1]), status: "DISMISSED" } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "c", savedAt: now } });
    const second = await saveAgentSearch({ name: "Overlap", query, sort: 1, enabled: true });
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ scored: 0, fresh: 0 });
    const links = await prisma().agentCandidateSearch.findMany();
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.candidateId === kept.id)).toBe(true);
    expect(links.some((link) => link.searchId === second.id)).toBe(true);
    expect(await prisma().agentCandidate.findUnique({ where: { id: dismissed.id } })).toEqual(dismissed);
  });

  it("prevents overlapping manual/scheduled scans while source dispatch is blocked", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(searchPostings).mockImplementationOnce(async () => { entered(); await blocked; return { postings: page, next: null }; });
    const running = runAgentScan({ manual: false }, context(), now);
    await started;
    try {
      expect((await runAgentScan({ manual: true }, context(), new Date(now.getTime() + hour))).message).toBe("An agent scan is already running.");
      expect((await loadSettings()).agentRuns).toHaveLength(1);
    } finally { release(); await running; }
  });

  it("doesn't execute a second scheduled job queued before the first one finished", async () => {
    await runAgentScan({ manual: false }, context(), now);
    expect((await runAgentScan({ manual: false }, context(), new Date(now.getTime() + hour))).message).toBe("The agent already ran today.");
    expect(fake.searches).toBe(1);
  });

  it("excludes Bundesagentur for all enabled searches and manual Agent runs too", async () => {
    await saveAgentSearch({ name: "Second", query, sort: 1, enabled: true });
    fake.source = "ARBEITSAGENTUR";
    expect((await runAgentScan({ manual: true }, context(), now)).message).toContain("doesn't search the Bundesagentur");
    expect(fake.searches).toBe(0);
    expect((await loadSettings()).agentRuns).toEqual([]);
  });

  it("searches once, scores the new postings and keeps them, below the minimum too", async () => {
    const run = context();
    const result = await runAgentScan({ manual: false }, run, now);
    expect(fake.searches).toBe(1);
    expect(run.steps).toEqual(["Searching for new postings", "Scoring 3 postings"]);
    // Only the senior posting's requirements are covered; the others list none, so they don't pass the cut-off (E32-2).
    expect(result).toEqual({ found: 3, fresh: 3, scored: 3, drafted: 0, skipped: 0, message: "1 new posting is waiting for a look." });
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { score: "desc" } });
    expect(candidates.map((candidate) => [candidate.externalId, candidate.score, candidate.status])).toEqual([
      ["a", 100, "SCORED"],
      ["b", 71, "SCORED"],
      ["c", 8, "SCORED"],
    ]);
    expect(candidates[0]).toMatchObject({ title: "Senior Product Designer", reasons: expect.arrayContaining(["Work experience 25/25: Work: high."]), dedupeKey: agentDedupeKey(page[0]) });
    // Find jobs shows the scores too (#208).
    expect((await prisma().postingScore.findMany({ orderBy: { score: "desc" } })).map((row) => [row.externalId, row.score])).toEqual([["a", 100], ["b", 71], ["c", 8]]);
    // The run is on record, with how it ended.
    expect((await loadSettings()).agentRuns).toEqual([{ at: now.toISOString(), manual: false, message: "1 new posting is waiting for a look.", sourceRequests: 1, sourceRequestAts: [expect.any(String)], sourceRequestPortals: ["JSEARCH"], searches: [expect.objectContaining({ searchName: "My search", found: 3, fresh: 3, error: null })] }]);
  });

  it("keeps what it finds but scores nothing until the profile's levels are chosen, and says so (E24-3)", async () => {
    await prisma().profile.update({ where: { id: TEST_PROFILE_ID }, data: { levelFrom: null, levelTo: null } });
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result).toMatchObject({ found: 3, fresh: 3, scored: 0, message: "Set the levels for “My profile” first. Choose them in Profile → Jobs it's for." });
    expect(await prisma().agentCandidate.count()).toBe(0);
    expect(await prisma().postingScore.count()).toBe(0);
  });

  it("scores each posting with the profile of the search that found it, and waits only for a profile without levels (E24-6)", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1 } });
    await saveAgentSearch({ name: "Go", query: { ...query, keywords: "Go engineer" }, sort: 1, enabled: true, profileId: backend.id });
    const go = posting("go", "Senior Go Engineer", "2026-10-19T00:00:00Z");
    vi.mocked(searchPostings)
      .mockImplementationOnce(async () => ({ postings: page, next: null }))
      .mockImplementationOnce(async () => ({ postings: [go, page[0]], next: null }));
    vi.mocked(loadProfile).mockClear();

    const result = await runAgentScan({ manual: false }, context(), now);
    // The designer postings are the first profile's, found first by its search; Backend has no levels yet.
    expect(result).toMatchObject({ fresh: 4, scored: 3, message: "1 new posting is waiting for a look. Postings found for “Backend” wait until its levels are chosen in Profile → Jobs it's for." });
    expect(vi.mocked(loadProfile).mock.calls.map(([id]) => id)).toEqual([TEST_PROFILE_ID]);
    expect(await prisma().postingScore.count({ where: { externalId: "go" } })).toBe(0);
  });

  it("scores a posting found by a profile's search with that profile once its levels are chosen (E24-6)", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1, levelFrom: "senior", levelTo: "lead" } });
    await prisma().agentSearch.updateMany({ data: { profileId: backend.id } });
    vi.mocked(searchPostings).mockImplementationOnce(async () => ({ postings: page, next: null }));
    vi.mocked(loadProfile).mockClear();

    expect(await runAgentScan({ manual: false }, context(), now)).toMatchObject({ scored: 3 });
    expect(vi.mocked(loadProfile).mock.calls.map(([id]) => id)).toEqual([backend.id]);
  });

  it("scores what an All profiles search finds against every profile with levels, and the cap counts postings (E25-5)", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1, levelFrom: "senior", levelTo: "lead" } });
    await prisma().profile.create({ data: { name: "Research", sort: 2 } });
    await prisma().agentSearch.updateMany({ data: { allProfiles: true } });
    await saveSettings({ agentMaxScores: 2 });
    vi.mocked(searchPostings).mockImplementationOnce(async () => ({ postings: page, next: null }));
    const scored: string[] = [];
    fake.onScore = (title) => scored.push(title);

    const result = await runAgentScan({ manual: false }, context(), now);
    // Two postings, each against the two profiles whose levels are chosen; Research waits.
    expect(result).toMatchObject({ fresh: 3, scored: 2 });
    expect(scored).toHaveLength(4);
    const scores = await prisma().postingScore.findMany({ orderBy: [{ externalId: "asc" }, { profileId: "asc" }] });
    expect(scores.map((row) => [row.externalId, row.profileId])).toEqual([
      ["a", backend.id],
      ["a", TEST_PROFILE_ID],
      ["b", backend.id],
      ["b", TEST_PROFILE_ID],
    ]);
    expect((await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" } })).map((candidate) => [candidate.externalId, candidate.score, candidate.skipReason])).toEqual([
      ["a", 100, null],
      ["b", 71, null],
      // Past the run's limit: kept under Skipped, still new to the next run (E32-5).
      ["c", 0, "budget"],
    ]);
  });

  it("sends one message after a scheduled run, with what's new for each search and its best, and never after Run now (E26-4)", async () => {
    const { emit } = await import("@/lib/notifications/notify");
    vi.mocked(emit).mockClear();
    await runAgentScan({ manual: true }, context(), now);
    expect(emit).not.toHaveBeenCalled();

    await prisma().agentCandidate.deleteMany();
    await prisma().posting.deleteMany();
    await prisma().postingScore.deleteMany();
    await saveSettings({ agentRuns: [] });
    await runAgentScan({ manual: false }, context(), now);
    expect(emit).toHaveBeenCalledTimes(1);
    const [name, data] = vi.mocked(emit).mock.calls[0] as unknown as [string, { newCount: number; searches: unknown[]; failed: unknown[]; postings: { title: string; portals: string[]; scores: unknown[] }[]; path: string }];
    expect(name).toBe("agent.run.finished");
    expect(data).toMatchObject({
      newCount: 3,
      searches: [{ name: "My search", newCount: 3, best: { title: "Senior Product Designer", company: "Company a", coverage: { hit: 1, total: 1 }, profile: "" } }],
      failed: [],
      path: expect.stringMatching(/^\/jobs\?found=/),
    });
    expect(data.postings[0]).toMatchObject({ title: "Senior Product Designer", portals: ["JSearch"], scores: [{ profile: "My profile", score: 100 }] });
  });

  it("scores with Jev when Settings → Scoring chose it, without an AI provider (#274)", async () => {
    fake.ai = false;
    await saveSettings({ scorer: "JEV" });
    expect(await runAgentScan({ manual: false }, context(), now)).toMatchObject({ found: 0, message: "Enter your TypeSafe key in Settings → Scoring first." });
    expect(fake.searches).toBe(0);

    await saveSettings({ typesafeKeyEnc: encryptSecret(TYPESAFE_KEY, "ts_secret") });
    // Jev at its most sure: every answer at the top for a designer's posting and at the bottom otherwise.
    const requests = stubFetch(({ body }) => {
      const { questions, state } = body as { questions: Record<string, { type: string; criteria?: unknown[] }>; state: { posting: { title: string } } };
      const fits = /designer/i.test(state.posting.title);
      const choices: Record<string, string> = { seniority: fits ? "fits" : "far-above", location: "fits" };
      const answer = (id: string, question: { type: string; criteria?: unknown[] }) =>
        question.type === "score"
          ? { type: "score", score: fits ? question.criteria!.length - 1 : 0, confidence: 0.9, probabilities: {} }
          : question.type === "choice"
            ? { type: "choice", choice: choices[id] ?? "must", confidence: 0.9, probabilities: {} }
            : { type: "noul", noul: id.endsWith("Covered") && fits ? 0.9 : 0.05 };
      return json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, answer(id, question)])) });
    });
    const result = await runAgentScan({ manual: false }, context(), now);
    vi.unstubAllGlobals();

    expect(result).toMatchObject({ found: 3, scored: 3, message: "2 new postings are waiting for a look." });
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual(["Bearer ts_secret", "Bearer ts_secret", "Bearer ts_secret"]);
    const candidates = await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" } });
    // Added up by the engine (E25): only where the office manager's job is fits.
    expect(candidates.map((candidate) => [candidate.externalId, candidate.score])).toEqual([["a", 100], ["b", 100], ["c", 10]]);
    expect(candidates[0].reasons).toContain("Requirements 35/35: You show 1 of 1 must-have.");
    expect(candidates[2].redFlags).toEqual(["Missing: Office Manager at Company c."]);
    expect((await prisma().postingScore.findFirstOrThrow({ where: { externalId: "a" } })).scoredWith).toBe("score-posting-jev@2 (jev-1.14.0)");
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
    // Nothing scored; each waits under Skipped with why (E32-5).
    expect((await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" } })).map((candidate) => [candidate.externalId, candidate.skipReason])).toEqual([
      ["a", "known"],
      ["b", "dismissed"],
      ["c", "known"],
    ]);
  });

  it("scores a posting it skipped for the limit on a later run, keeping one row (E32-5)", async () => {
    await saveSettings({ agentMaxScores: 2 });
    await runAgentScan({ manual: true }, context(), now);
    expect(await prisma().agentCandidate.findMany({ where: { skipReason: "budget" }, select: { externalId: true } })).toEqual([{ externalId: "c" }]);
    await saveSettings({ agentMaxScores: 15 });
    const next = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 4 * hour));
    expect(next).toMatchObject({ fresh: 1, scored: 1 });
    expect((await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" } })).map((candidate) => [candidate.externalId, candidate.skipReason, candidate.score > 0])).toEqual([
      ["a", null, true],
      ["b", null, true],
      ["c", null, true],
    ]);
  });

  it("stops without asking the source when it's off, not set up, or has run 3 times in 24 hours", async () => {
    const stop = async (manual = false) => (await runAgentScan({ manual }, context(), now)).message;
    await saveSettings({ agentEnabled: false });
    expect(await stop()).toBe("The job agent is off.");
    await saveSettings({ agentEnabled: true });
    await prisma().agentSearch.deleteMany();
    expect(await stop()).toBe("Add what to look for in Settings → Job agent first.");
    const search = await prisma().agentSearch.create({ data: { name: "My search", query: { ...query, country: "" } } });
    expect(await stop()).toBe("Choose a country for “My search” in Settings → Job agent first.");
    await prisma().agentSearch.update({ where: { id: search.id }, data: { query } });
    fake.ai = false;
    expect(await stop()).toBe("Choose an AI provider in Settings → AI provider first.");
    fake.ai = true;
    fake.source = null;
    expect(await stop()).toBe("Switch on a portal in Settings → Job search first.");
    // It never searches the Bundesagentur für Arbeit on its own (#223).
    fake.source = "ARBEITSAGENTUR";
    expect(await stop()).toBe("The job agent doesn't search the Bundesagentur für Arbeit. Switch on JSearch, Adzuna or FreeHire in Settings → Job search for it.");
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
    expect(fourth.message).toBe("The agent needs 1 request to JSearch this run, but may send each portal only 3 in 24 hours. Next eligible: Wed 21 Oct, 08:00 (UTC).");
    expect(fake.searches).toBe(3);
    // A day after the first, one may go again.
    const firstAttempt = (await loadSettings()).agentRuns.at(-1)!.sourceRequestAts![0];
    await runAgentScan({ manual: true }, context(), new Date(Date.parse(firstAttempt) + 24 * hour));
    expect(fake.searches).toBe(4);
  });

  it("records the run before it asks the source, so a failing source still counts", async () => {
    const { searchPostings } = await import("@/lib/job-search");
    vi.mocked(searchPostings).mockRejectedValueOnce(new Error("socket hang up"));
    const result = await runAgentScan({ manual: false }, context(), now);
    expect(result.message).toContain("My search: JSearch: The portal couldn't be reached. Try again.");
    expect((await loadSettings()).agentRuns).toEqual([{ at: now.toISOString(), manual: false, message: result.message, sourceRequests: 1, sourceRequestAts: [expect.any(String)], sourceRequestPortals: ["JSEARCH"], searches: [expect.objectContaining({ found: 0, fresh: 0, error: "JSearch: The portal couldn't be reached. Try again." })] }]);
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
    expect(result.scored).toBe(0);
    expect(await prisma().agentCandidate.count()).toBe(0);
  });

  it("queues drafts for the best new postings when auto-draft is on, up to the cap (#197)", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    vi.mocked(startJob).mockClear();
    expect((await runAgentScan({ manual: false }, context(), now)).drafted).toBe(0);
    expect(startJob).not.toHaveBeenCalled();

    await prisma().agentCandidate.deleteMany();
    await saveSettings({ agentAutoDraft: true, agentMaxDrafts: 1 });
    const result = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 2 * hour));
    expect(result).toMatchObject({ scored: 3, drafted: 1, message: "1 new posting is waiting for a look. Preparing a draft for the best one." });
    const best = await prisma().agentCandidate.findFirstOrThrow({ where: { externalId: "a" } });
    expect(startJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: best.id, auto: true }, { key: `agent-candidate:${best.id}` });
  });

  it("says when nothing covers enough of the requirements (E32-2)", async () => {
    fake.postings = [page[2]];
    expect((await runAgentScan({ manual: false }, context(), now)).message).toBe("Scored 1 new posting; none covers at least two thirds of the requirements.");
    expect(demoProfile().basics.name).toBe("Jane Doe");
  });
});

describe("the agent on many portals (E22-8)", () => {
  const agentFilters = { ...DEFAULT_FILTERS, found: FOUND_BY_AGENT };

  it("asks every portal that covers the country, and what it finds lands in Positions, best first", async () => {
    fake.extra = ["FREEHIRE", "ARBEITSAGENTUR"];
    const result = await runAgentScan({ manual: false }, context(), now);
    // The Bundesagentur für Arbeit is never asked (#223).
    expect(fake.searches).toBe(2);
    const [run] = (await loadSettings()).agentRuns;
    expect(run.sourceRequestPortals).toEqual(["JSEARCH", "FREEHIRE"]);
    expect(run.searches![0]).toMatchObject({ searchName: "My search", found: 3, error: null, portals: [{ id: "JSEARCH", status: "done", found: 3 }, { id: "FREEHIRE", status: "done", found: 3 }] });
    // The same job on both portals is one posting, scored once.
    expect(result).toMatchObject({ found: 3, scored: 3 });
    const { postings } = await listLibrary(agentFilters, { now });
    expect(postings.map((posting) => [posting.title, posting.state.score?.score])).toEqual([
      ["Senior Product Designer", 100],
      ["Product Designer", 71],
      ["Office Manager", 8],
    ]);
    expect(postings[0].state).toMatchObject({ agentSearches: ["My search"], agent: { status: "SCORED" } });
    // Found on both; which portal's copy is the one shown depends on which answered first.
    expect(postings[0].state.foundOn.map((entry) => entry.portal).toSorted()).toEqual(["FREEHIRE", "JSEARCH"]);
    // Its runs aren't in Found by's list of searches; "The job agent" is.
    expect(await listSearches({ now })).toEqual([]);
  });

  it("skips a portal that doesn't cover the search's country, saying so", async () => {
    fake.source = "ADZUNA";
    fake.extra = ["FREEHIRE"];
    await prisma().agentSearch.updateMany({ data: { query: { ...query, country: "se" } } });
    await runAgentScan({ manual: false }, context(), now);
    const [run] = (await loadSettings()).agentRuns;
    expect(run.sourceRequestPortals).toEqual(["FREEHIRE"]);
    expect(run.searches![0].portals).toEqual([
      { id: "FREEHIRE", status: "done", found: 3, message: null },
      { id: "ADZUNA", status: "skipped", found: 0, message: "Adzuna doesn't cover Sweden." },
    ]);
  });

  it("budgets each portal apart: three requests a day each", async () => {
    fake.extra = ["FREEHIRE"];
    for (let index = 0; index < 3; index++) await runAgentScan({ manual: true }, context(), new Date(now.getTime() + index * 2 * hour));
    expect(fake.searches).toBe(6);
    const fourth = await runAgentScan({ manual: true }, context(), new Date(now.getTime() + 6 * hour));
    expect(fourth.message).toContain("The agent needs 1 request to JSearch and 1 request to FreeHire this run");
  });

  it("keeps a score from Positions instead of asking the AI again", async () => {
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "b", profileId: TEST_PROFILE_ID, score: 66, reasons: ["Scored by hand."], redFlags: [], scoredWith: "test" } });
    const scored: string[] = [];
    fake.onScore = (title) => void scored.push(title);
    await saveSettings({ agentMaxScores: 1 });
    const result = await runAgentScan({ manual: false }, context(), now);
    // The newest is scored; the one scored before costs nothing; the last stays unscored.
    expect(scored).toEqual(["Senior Product Designer"]);
    expect(result).toMatchObject({ scored: 2 });
    expect((await prisma().agentCandidate.findMany({ where: { skipReason: null }, orderBy: { externalId: "asc" } })).map((candidate) => [candidate.externalId, candidate.score])).toEqual([
      ["a", 100],
      ["b", 66],
    ]);
    expect((await listLibrary(agentFilters, { now })).postings.map((posting) => posting.externalId)).toEqual(["a", "b", "c"]);
  });
});
