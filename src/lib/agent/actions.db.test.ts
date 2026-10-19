import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_QUERY } from "@/lib/job-search/search";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { approveAgentCandidate, dismissAgentCandidate, prepareAgentDraft, runAgentNow, saveAgentSettings } from "./actions";
import { manualRunProblem } from "./run";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const runner = vi.hoisted(() => ({
  startJob: vi.fn(async () => "job-1"),
  findUnfinishedJobs: vi.fn(async (): Promise<{ id: string; type: string; input: unknown }[]> => []),
  cancelJob: vi.fn(async () => {}),
}));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  ...runner,
}));

const config = vi.hoisted(() => ({ ai: true, source: "JSEARCH" as string | null, credentials: true }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => config.ai }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ source: config.source }),
  credentialsFor: () => {
    if (!config.credentials) throw new Error("no key");
    return { key: "test", host: "openwebninja" };
  },
}));

const prisma = () => db.client!;

beforeEach(() => {
  runner.startJob.mockClear();
  runner.startJob.mockResolvedValue("job-1");
  runner.findUnfinishedJobs.mockClear();
  runner.findUnfinishedJobs.mockResolvedValue([]);
  runner.cancelJob.mockClear();
  config.ai = true;
  config.source = "JSEARCH";
  config.credentials = true;
  return resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

async function application(company: string) {
  return prisma().application.create({
    data: { title: `${company} application`, company, role: "Designer", status: "DRAFT" },
  });
}

async function candidate(applicationId: string | null, status: "SCORED" | "DRAFTED" = "DRAFTED") {
  return prisma().agentCandidate.create({
    data: {
      source: "JSEARCH",
      externalId: `job-${Math.random()}`,
      title: "Senior Product Designer",
      company: "Ledgerly",
      score: 88,
      dedupeKey: `agent:${Math.random()}`,
      status,
      applicationId,
    },
  });
}

describe("the agent queue (E16)", () => {
  it("approves a prepared draft without sending it", async () => {
    const app = await application("Ledgerly");
    const row = await candidate(app.id);

    expect(await approveAgentCandidate({ candidateId: row.id })).toMatchObject({ ok: true, data: { applicationId: app.id } });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "APPROVED" });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "DRAFT", sentAt: null });
  });

  it("dismisses a draft, deletes its application and keeps the posting out of Find jobs", async () => {
    const app = await application("Ledgerly");
    const row = await candidate(app.id);
    const posting = await prisma().posting.create({
      data: { source: "JSEARCH", externalId: "job-posting", title: "Designer", company: "Ledgerly", applicationId: app.id },
    });

    expect(await dismissAgentCandidate({ candidateId: row.id })).toMatchObject({ ok: true });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "DISMISSED",
      applicationId: null,
    });
    expect(await prisma().application.count()).toBe(0);
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({
      applicationId: null,
      dismissedAt: expect.any(Date),
    });
  });

  it("refuses to approve a posting that only has a score", async () => {
    const row = await candidate(null, "SCORED");
    expect(await approveAgentCandidate({ candidateId: row.id })).toMatchObject({ ok: false });
  });

  it("keeps a manual run an hour apart, and saves the search as a setting", async () => {
    expect(await saveAgentSettings({
      enabled: true,
      query: { ...EMPTY_QUERY, keywords: "designer", country: "nl" },
      hour: 7,
      minScore: 75,
      maxScores: 12,
      maxDrafts: 2,
      autoDraft: true,
    })).toMatchObject({ ok: true });

    expect(await loadSettings()).toMatchObject({
      agentEnabled: true,
      agentQuery: { ...EMPTY_QUERY, keywords: "designer", country: "nl" },
      agentMinScore: 75,
      agentMaxScores: 12,
      agentMaxDrafts: 2,
    });

    await saveSettings({ agentLastRunAt: new Date().toISOString() });
    expect(await manualRunProblem()).toMatch(/^The agent ran recently/);
    await saveSettings({ agentLastRunAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });
    expect(await manualRunProblem()).toBeNull();
  });

  it("refuses to turn on a search without keywords and a country", async () => {
    expect(await saveAgentSettings({
      enabled: true,
      query: { ...EMPTY_QUERY, country: "nl" },
      hour: 7,
      minScore: 70,
      maxScores: 15,
      maxDrafts: 3,
      autoDraft: true,
    })).toMatchObject({ ok: false, error: expect.stringMatching(/Type what/) });

    expect(await saveAgentSettings({
      enabled: true,
      query: { ...EMPTY_QUERY, keywords: "designer" },
      hour: 7,
      minScore: 70,
      maxScores: 15,
      maxDrafts: 3,
      autoDraft: true,
    })).toMatchObject({ ok: false, error: expect.stringMatching(/Choose a country/) });
  });
});

describe("running the agent from the screen (E16)", () => {
  const ready = { agentEnabled: true, agentQuery: { ...EMPTY_QUERY, keywords: "designer", country: "nl" } };

  it("starts one background run, or returns the one already running", async () => {
    await saveSettings(ready);
    expect(await runAgentNow({})).toMatchObject({ ok: true, data: { jobId: "job-1", reused: false } });
    expect(runner.startJob).toHaveBeenCalledWith(expect.objectContaining({ type: "agent-scan" }), { manual: true }, { key: "agent" });

    runner.findUnfinishedJobs.mockResolvedValueOnce([{ id: "already", type: "agent-scan", input: {} }]);
    expect(await runAgentNow({})).toMatchObject({ ok: true, data: { jobId: "already", reused: true } });
    expect(runner.startJob).toHaveBeenCalledTimes(1);
  });

  it("explains why it can't run yet", async () => {
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/Turn the job agent on/) });

    await saveSettings({ ...ready, agentQuery: EMPTY_QUERY });
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/Finish the agent search/) });

    await saveSettings({ ...ready, agentLastRunAt: new Date().toISOString() });
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/ran recently/) });

    await saveSettings({ ...ready, agentLastRunAt: null });
    config.ai = false;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/AI provider/) });

    config.ai = true;
    config.source = null;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/job source/) });

    config.source = "JSEARCH";
    config.credentials = false;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/isn't ready/) });
  });

  it("prepares a draft once, and reuses a draft already being written", async () => {
    const app = await application("Ledgerly");
    const drafted = await candidate(app.id);
    expect(await prepareAgentDraft({ candidateId: drafted.id })).toMatchObject({
      ok: true,
      data: { jobId: null, applicationId: app.id },
    });

    const processing = await candidate(null, "SCORED");
    await prisma().agentCandidate.update({ where: { id: processing.id }, data: { status: "DRAFTING" } });
    expect(await prepareAgentDraft({ candidateId: processing.id })).toMatchObject({ ok: false, error: expect.stringMatching(/already being prepared/) });

    const scored = await candidate(null, "SCORED");
    expect(await prepareAgentDraft({ candidateId: scored.id })).toMatchObject({ ok: true, data: { jobId: "job-1", applicationId: null } });
    expect(runner.startJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-draft" }),
      { candidateId: scored.id },
      { key: `agent-candidate:${scored.id}` },
    );

    runner.findUnfinishedJobs.mockResolvedValueOnce([{ id: "draft-already", type: "agent-draft", input: {} }]);
    expect(await prepareAgentDraft({ candidateId: scored.id })).toMatchObject({
      ok: true,
      data: { jobId: "draft-already", applicationId: null },
    });
  });

  it("cancels a draft that is still being written when it's dismissed", async () => {
    const processing = await candidate(null, "SCORED");
    await prisma().agentCandidate.update({ where: { id: processing.id }, data: { status: "DRAFTING" } });
    runner.findUnfinishedJobs.mockResolvedValueOnce([{ id: "draft-job", type: "agent-draft", input: {} }]);

    expect(await dismissAgentCandidate({ candidateId: processing.id })).toMatchObject({ ok: true });
    expect(runner.cancelJob).toHaveBeenCalledWith("draft-job");
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: processing.id } })).toMatchObject({ status: "DISMISSED" });
  });
});
