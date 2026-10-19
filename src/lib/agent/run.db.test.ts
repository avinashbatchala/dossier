import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoLetterUnits, demoResumeUnits } from "@/lib/demo-profile";
import { EMPTY_QUERY, type FoundPosting } from "@/lib/job-search/search";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";

import { draftCandidate, runAgentScan } from "./run";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("@/lib/job-search/find", () => ({ fullText: async () => "Ledgerly is hiring a Senior Product Designer." }));
vi.mock("@/lib/one-page", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/one-page")>()),
  fitResumeToOnePage: async () => ({ trimmed: [], fits: true }),
}));

const search = vi.hoisted(() => ({
  postings: [] as FoundPosting[],
  score: 80,
  fail: false,
  configured: true,
  source: "JSEARCH" as "JSEARCH" | null,
}));
vi.mock("@/lib/job-search", () => ({ searchPostings: async () => ({ postings: search.postings, next: null }) }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ source: search.source }),
  credentialsFor: () => ({ key: "test", host: "openwebninja" }),
  requestContext: () => ({}),
}));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => search.configured }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () => ({}),
}));
vi.mock("@/lib/ai/tasks", () => ({
  scorePosting: async () => {
    if (search.fail) {
      const { AiError } = await import("@/lib/ai");
      throw AiError.of("unreachable");
    }
    return { data: { score: search.score, reasons: ["Figma and design systems match"], redFlags: [] }, promptVersion: "score-posting@1" };
  },
}));

const extracted = {
  title: "Senior Product Designer · Ledgerly",
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: "Hybrid",
  salary: "€75,000–€90,000",
  deadline: "2026-10-15",
  requirements: [{ text: "Experience with payments", kind: "other" as const, skill: null, years: null, language: null }],
  asksForReferences: false,
  language: "English",
};
const match = { items: [{ requirement: "Experience with payments", result: "gap" as const, skill: null, experienceIds: [], note: "Nothing in your profile" }] };
const reading = { extracted, extractedWith: "extract-posting@1", match, matchedWith: "match-requirements@1" };
const documents = { resume: demoResumeUnits(), resumeWith: "tailor-resume@3", letter: demoLetterUnits(), letterWith: "write-cover-letter@4" };

vi.mock("@/lib/jobs/read-posting", () => ({ readPostingJob: { run: async () => reading } }));
vi.mock("@/lib/jobs/write-documents", () => ({ writeDocumentsJob: { run: async () => documents } }));

const prisma = () => db.client!;
const context = { id: "agent-run-1", step: async () => {}, signal: new AbortController().signal };

function foundPosting(id: string, extra: Partial<FoundPosting> = {}): FoundPosting {
  return {
    source: "JSEARCH",
    externalId: id,
    title: "Senior Product Designer",
    company: "Ledgerly",
    place: "Amsterdam",
    remote: false,
    salary: "€75,000–€90,000",
    postedAt: new Date(Date.now() - 60_000).toISOString(),
    url: `https://jobs.example/${id}`,
    via: "LinkedIn",
    description: "Ledgerly is hiring a Senior Product Designer.",
    complete: true,
    ...extra,
  };
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  search.postings = [foundPosting("job-a"), foundPosting("job-b")];
  search.score = 80;
  search.fail = false;
  search.configured = true;
  search.source = "JSEARCH";
});
afterAll(() => prisma().$disconnect());

describe("draftCandidate (E16)", () => {
  it("turns a scored posting into a tailored Draft application and clears the queue item", async () => {
    const candidate = await prisma().agentCandidate.create({
      data: {
        jobId: "agent-run-1",
        source: "JSEARCH",
        externalId: "job-1",
        title: "Senior Product Designer",
        company: "Ledgerly",
        place: "Amsterdam",
        remote: false,
        salary: "€75,000–€90,000",
        url: "https://jobs.example/ledgerly/1",
        description: "A short snippet",
        complete: false,
        score: 88,
        reasons: ["Figma matches"],
        redFlags: [],
        dedupeKey: "agent:test-1",
      },
    });

    const applicationId = await draftCandidate(candidate.id, context);

    const application = await prisma().application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { documents: { orderBy: { kind: "asc" } }, agentCandidate: true },
    });
    expect(application).toMatchObject({
      origin: "AGENT",
      agentScore: 88,
      agentJobId: "agent-run-1",
      company: "Ledgerly",
      role: "Senior Product Designer",
      status: "DRAFT",
      postingUrl: "https://jobs.example/ledgerly/1",
      postingText: "Ledgerly is hiring a Senior Product Designer.",
    });
    expect(application.documents.map((document) => document.kind)).toEqual(["RESUME", "COVER_LETTER"]);
    expect(application.agentCandidate).toMatchObject({ id: candidate.id, status: "DRAFTED", applicationId });
    expect(await prisma().posting.count()).toBe(1);
  });

  it("refuses to draft the same candidate twice", async () => {
    const candidate = await prisma().agentCandidate.create({
      data: {
        jobId: "agent-run-1",
        source: "JSEARCH",
        externalId: "job-2",
        title: "Designer",
        company: "Ledgerly",
        score: 80,
        dedupeKey: "agent:test-2",
      },
    });
    const first = await draftCandidate(candidate.id, context);
    expect(await draftCandidate(candidate.id, context)).toBe(first);
    expect(await prisma().application.count()).toBe(1);
  });

  it("stops after three runs in 24 hours, before spending another source request", async () => {
    await saveSettings({
      agentEnabled: true,
      agentQuery: { ...EMPTY_QUERY, keywords: "designer", country: "nl" },
    });
    for (let index = 0; index < 3; index += 1) {
      await prisma().job.create({
        data: { type: "agent-scan", status: "DONE", input: {}, createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
    }

    const result = await runAgentScan({ manual: true }, { ...context, id: "today" });
    expect(result).toMatchObject({ found: 0, scored: 0, drafted: 0 });
    expect(result.message).toMatch(/3 times in the past day/);
  });
});

describe("runAgentScan (E16)", () => {
  const ready = { agentEnabled: true, agentQuery: { ...EMPTY_QUERY, keywords: "designer", country: "nl" }, agentMinScore: 70 };

  it("scores each new posting once, then skips it on the next run", async () => {
    await saveSettings({ ...ready, agentAutoDraft: false, agentMaxScores: 5 });
    const first = await runAgentScan({ manual: true }, context);
    expect(first).toMatchObject({ found: 2, fresh: 2, scored: 2, drafted: 0, skipped: 0 });
    expect(await prisma().agentCandidate.count()).toBe(2);
    expect(await prisma().agentCandidate.findMany({ select: { reasons: true, redFlags: true } })).toEqual([
      { reasons: ["Figma and design systems match"], redFlags: [] },
      { reasons: ["Figma and design systems match"], redFlags: [] },
    ]);

    const second = await runAgentScan({ manual: true }, { ...context, id: "agent-run-2" });
    expect(second).toMatchObject({ found: 2, fresh: 0, scored: 0, drafted: 0 });
    expect(second.message).toBe("No new postings this time.");
    expect(await prisma().agentCandidate.count()).toBe(2);
  });

  it("prepares only the best drafts when auto-draft is on", async () => {
    await saveSettings({ ...ready, agentAutoDraft: true, agentMaxDrafts: 1, agentMaxScores: 5 });
    const result = await runAgentScan({ manual: true }, context);
    expect(result).toMatchObject({ scored: 2, drafted: 1 });
    expect(await prisma().application.count({ where: { origin: "AGENT" } })).toBe(1);
    expect(await prisma().agentCandidate.count({ where: { status: "DRAFTED" } })).toBe(1);
    expect(await prisma().agentCandidate.count({ where: { status: "SCORED" } })).toBe(1);
  });

  it("keeps postings below the score threshold in the queue, but does not draft them", async () => {
    search.score = 40;
    await saveSettings({ ...ready, agentAutoDraft: true, agentMaxDrafts: 3, agentMaxScores: 5 });
    const result = await runAgentScan({ manual: true }, context);
    expect(result).toMatchObject({ scored: 2, drafted: 0 });
    expect(await prisma().agentCandidate.count({ where: { status: "SCORED" } })).toBe(2);
  });

  it("skips saved postings without scoring them", async () => {
    await prisma().posting.create({
      data: { source: "JSEARCH", externalId: "job-a", title: "Saved", company: "Ledgerly", savedAt: new Date() },
    });
    await saveSettings({ ...ready, agentAutoDraft: false, agentMaxScores: 5 });
    const result = await runAgentScan({ manual: true }, context);
    expect(result).toMatchObject({ found: 2, fresh: 1, scored: 1 });
  });

  it("explains what is missing before it asks the source", async () => {
    await saveSettings({ ...ready, agentEnabled: false, agentAutoDraft: false });
    expect((await runAgentScan({ manual: false }, context)).message).toBe("The job agent is off.");

    await saveSettings({ ...ready, agentEnabled: true, agentQuery: EMPTY_QUERY });
    expect((await runAgentScan({ manual: true }, context)).message).toMatch(/Add keywords/);

    await saveSettings({ ...ready, agentQuery: { ...EMPTY_QUERY, keywords: "designer", country: "" } });
    expect((await runAgentScan({ manual: true }, context)).message).toMatch(/Choose a country/);

    await saveSettings({ ...ready });
    search.configured = false;
    expect((await runAgentScan({ manual: true }, context)).message).toMatch(/AI provider/);

    search.configured = true;
    search.source = null;
    expect((await runAgentScan({ manual: true }, context)).message).toMatch(/job source/);
  });

  it("reports an AI failure without creating candidates", async () => {
    await saveSettings({ ...ready, agentAutoDraft: false });
    search.fail = true;
    const result = await runAgentScan({ manual: true }, context);
    expect(result).toMatchObject({ scored: 0, drafted: 0 });
    expect(result.message).toMatch(/Couldn't reach/);
    expect(await prisma().agentCandidate.count()).toBe(0);
  });
});
