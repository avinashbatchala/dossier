import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchQuery } from "@/lib/job-search/search";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { setStatus } from "@/lib/status-actions";
import { createTestClient, resetDatabase } from "@/test/db";

import { approveAgentDraft, dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate, runAgentNow, saveAgentSettings } from "./actions";

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
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "new-run"),
}));
const setup = vi.hoisted(() => ({ ai: true, source: "JSEARCH" as "JSEARCH" | null }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => setup.ai }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ source: setup.source, saved: true, jsearch: { key: "k", host: "openwebninja", keyState: "set" }, adzuna: { appId: "", key: null, keyState: "none" } }),
  credentialsFor: () => ({ key: "k", host: "openwebninja" }),
  requestContext: () => ({}),
}));

const prisma = () => db.client!;
const candidate = (data: { status?: "SCORED" | "DRAFTED" | "DRAFTING"; applicationId?: string } = {}) =>
  prisma().agentCandidate.create({
    data: { source: "JSEARCH", externalId: `job-${Math.random()}`, dedupeKey: `key-${Math.random()}`, title: "Data Scientist", company: "Ledgerly", url: "https://jobs.example/1", score: 88, reasons: ["Python"], ...data },
  });
const query: SearchQuery = { keywords: "Data scientist", place: "", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" };

beforeEach(async () => {
  Object.assign(setup, { ai: true, source: "JSEARCH" });
  await resetDatabase(prisma());
  await saveSettings({ agentEnabled: true, agentQuery: query });
});
afterAll(() => prisma().$disconnect());

describe("Run now (E16-4)", () => {
  it("starts a run, keyed so the schedule and the screen find it", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    expect(await runAgentNow({})).toEqual({ ok: true, data: { jobId: "new-run", reused: false } });
    expect(startJob).toHaveBeenLastCalledWith(expect.objectContaining({ type: "agent-scan" }), { manual: true }, { key: "agent" });
  });

  it("reuses a run that's queued or running", async () => {
    const running = await prisma().job.create({ data: { type: "agent-scan", key: "agent", status: "RUNNING", input: { manual: false } } });
    expect(await runAgentNow({})).toEqual({ ok: true, data: { jobId: running.id, reused: true } });
  });

  it("says what's missing before it starts", async () => {
    await saveSettings({ agentEnabled: false });
    expect(await runAgentNow({})).toEqual({ ok: false, error: "Turn the job agent on in Settings → Job agent first." });
    await saveSettings({ agentEnabled: true, agentQuery: { ...query, keywords: "" } });
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Add what to look for in Settings → Job agent first." });
    await saveSettings({ agentQuery: query });
    setup.ai = false;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Choose an AI provider in Settings → AI provider first." });
    setup.ai = true;
    setup.source = null;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Choose a job source in Settings → Job search first." });
  });

  it("waits an hour after the previous run, and keeps to 3 a day", async () => {
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    await saveSettings({ agentRuns: [{ at: at(20), manual: false, message: null }] });
    expect(await runAgentNow({})).toEqual({ ok: false, error: "The agent ran less than an hour ago. Try again in 40 minutes." });
    await saveSettings({ agentRuns: [at(70), at(200), at(400)].map((time) => ({ at: time, manual: true, message: null })) });
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/^The agent has run 3 times in the past 24 hours/) });
  });
});

describe("the drafts' actions (E16-5)", () => {
  it("prepares a draft in its own job, reuses one under way, and answers with one already made", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    const scored = await candidate();
    expect(await prepareAgentDraft({ candidateId: scored.id })).toEqual({ ok: true, data: { jobId: "new-run", applicationId: null } });
    expect(startJob).toHaveBeenLastCalledWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: scored.id }, { key: `agent-candidate:${scored.id}` });

    const queued = await prisma().job.create({ data: { type: "agent-draft", key: `agent-candidate:${scored.id}`, input: { candidateId: scored.id } } });
    expect(await prepareAgentDraft({ candidateId: scored.id })).toEqual({ ok: true, data: { jobId: queued.id, applicationId: null } });

    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await prepareAgentDraft({ candidateId: drafted.id })).toEqual({ ok: true, data: { jobId: null, applicationId: application.id } });
    expect(await prepareAgentDraft({ candidateId: "gone" })).toEqual({ ok: false, error: "That posting is no longer in the agent's queue." });
  });

  it("approves a draft into Applications, saying nothing was sent", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await approveAgentDraft({ candidateId: drafted.id })).toEqual({
      ok: true,
      data: { applicationId: application.id },
      toast: "Added to Applications as a draft. Nothing has been sent.",
    });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ awaitingReview: false });
  });

  it("dismisses a posting, with what Undo needs, and puts it back", async () => {
    const scored = await candidate();
    const result = await dismissAgentCandidate({ candidateId: scored.id });
    expect(result).toMatchObject({ ok: true, data: { undo: { id: scored.id, url: "https://jobs.example/1", reasons: ["Python"] } } });
    if (!result.ok || !result.data.undo) throw new Error("no undo");
    // As the browser sends it back: dates as strings, and a link that must stay a web address.
    const sent = JSON.parse(JSON.stringify(result.data.undo));
    expect(await restoreAgentCandidate({ ...sent, url: "javascript:alert(1)" })).toEqual({ ok: true, data: null });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: scored.id } })).toMatchObject({ status: "SCORED", url: "", reasons: ["Python"] });
  });

  it("approves a draft waiting for review when its status moves on (#195)", async () => {
    const application = await prisma().application.create({ data: { origin: "AGENT", awaitingReview: true } });
    const drafted = await candidate({ status: "DRAFTED", applicationId: application.id });
    expect(await setStatus({ id: application.id, to: "SENT" })).toMatchObject({ ok: true });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ status: "SENT", awaitingReview: false });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: drafted.id } })).toMatchObject({ status: "APPROVED" });
  });
});

describe("saving the agent's settings (E16-7)", () => {
  it("saves each change, and turns on only with keywords and a country", async () => {
    await saveSettings({ agentEnabled: false, agentQuery: { ...query, keywords: "" } });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error: "Type what the agent should look for before turning it on." });
    expect(await saveAgentSettings({ enabled: true, query: { ...query, country: "" } })).toEqual({ ok: false, error: "Choose a country for the search before turning the agent on." });
    expect(await saveAgentSettings({ enabled: true, query })).toEqual({ ok: true, data: null });
    expect(await saveAgentSettings({ hour: 9, minScore: 80, autoDraft: true, maxDrafts: 5 })).toEqual({ ok: true, data: null });
    expect(await loadSettings()).toMatchObject({ agentEnabled: true, agentQuery: query, agentHour: 9, agentMinScore: 80, agentAutoDraft: true, agentMaxDrafts: 5, agentMaxScores: 15 });
    expect(await saveAgentSettings({ maxScores: 31 })).toMatchObject({ ok: false });
  });
});
