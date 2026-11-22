import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchQuery } from "@/lib/job-search/search";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { setStatus } from "@/lib/status-actions";
import { getSession } from "@/lib/auth/session";
import { createTestClient, resetDatabase } from "@/test/db";

import { approveAgentDraft, dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate, runAgentNow, saveAgentSettings, saveRecurringSearch, deleteRecurringSearch, moveRecurringSearch, setRecurringSearchEnabled } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Settings → Scoring reads DOSSIER_SCORER (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "new-run"),
}));
const setup = vi.hoisted(() => ({ ai: true, source: "JSEARCH" as "JSEARCH" | null }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => setup.ai }));
vi.mock("@/lib/job-search/config", () => ({
  loadJobSearchConfig: async () => ({ saved: true, freehire: { url: "https://freehire.me" }, portals: setup.source ? [{ id: setup.source, on: true, offered: true, fields: {}, keys: {}, acceptedAt: null }] : [] }),
  enabledPortals: (config: { portals: { id: string; on: boolean }[] }) => config.portals.filter((portal) => portal.on).map((portal) => portal.id),
  agentPortal: (config: { portals: { id: string; on: boolean }[] }) => config.portals.find((portal) => portal.on && portal.id !== "ARBEITSAGENTUR")?.id ?? null,
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
  await saveSettings({ agentEnabled: true });
  await prisma().agentSearch.create({ data: { name: "My search", query } });
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
    await saveSettings({ agentEnabled: true });
    await prisma().agentSearch.deleteMany();
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Add what to look for in Settings → Job agent first." });
    await prisma().agentSearch.create({ data: { name: "My search", query } });
    setup.ai = false;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Choose an AI provider in Settings → AI provider first." });
    setup.ai = true;
    setup.source = null;
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: "Switch on a portal in Settings → Job search first." });
  });

  it("waits an hour after the previous run, and keeps to 3 a day", async () => {
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    await saveSettings({ agentRuns: [{ at: at(20), manual: false, message: null }] });
    expect(await runAgentNow({})).toEqual({ ok: false, error: "The agent ran less than an hour ago. Try again in 40 minutes." });
    await saveSettings({ agentRuns: [at(70), at(200), at(400)].map((time) => ({ at: time, manual: true, message: null })) });
    expect(await runAgentNow({})).toMatchObject({ ok: false, error: expect.stringMatching(/^The agent needs 1 request to /) });
  });

  it("formats quota eligibility in the same user timezone as the Agent view", async () => {
    const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await saveSettings({ agentRuns: [{ at, manual: true, message: "Done", sourceRequests: 3 }] });
    const result = await runAgentNow({});
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("(Europe/Berlin)") });
    expect(result).not.toMatchObject({ error: expect.stringMatching(/\d{4}-\d{2}-\d{2}T/) });
  });
});

describe("the drafts' actions (E16-5)", () => {
  it("prepares a draft in its own job, reuses one under way, and answers with one already made", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    const scored = await candidate();
    expect(await prepareAgentDraft({ candidateId: scored.id })).toEqual({ ok: true, data: { jobId: "new-run", applicationId: null } });
    expect(startJob).toHaveBeenLastCalledWith(expect.objectContaining({ type: "agent-draft" }), { candidateId: scored.id, auto: false }, { key: `agent-candidate:${scored.id}` });

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
    const search = await prisma().agentSearch.findFirstOrThrow();
    await prisma().agentCandidateSearch.create({ data: { candidateId: scored.id, searchId: search.id, searchName: "Original search name" } });
    const result = await dismissAgentCandidate({ candidateId: scored.id });
    expect(result).toMatchObject({ ok: true, data: { undo: { id: scored.id, url: "https://jobs.example/1", reasons: ["Python"] } } });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: scored.id } })).toMatchObject({ status: "DISMISSED", url: "", description: "", reasons: [] });
    expect(await prisma().agentCandidateSearch.findMany()).toEqual([]);
    if (!result.ok || !result.data.undo) throw new Error("no undo");
    // As the browser sends it back: dates as strings, and a link that must stay a web address.
    const sent = JSON.parse(JSON.stringify(result.data.undo));
    expect(await restoreAgentCandidate({ ...sent, url: "javascript:alert(1)" })).toEqual({ ok: true, data: null });
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: scored.id } })).toMatchObject({ status: "SCORED", url: "", reasons: ["Python"] });
    expect(await prisma().agentCandidateSearch.findMany()).toEqual([]);
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
    await saveSettings({ agentEnabled: false });
    await prisma().agentSearch.deleteMany();
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error: "Add what to look for in Settings → Job agent first." });
    const search = await prisma().agentSearch.create({ data: { name: "My search", query: { ...query, country: "" } } });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error: "Choose a country for “My search” in Settings → Job agent first." });
    await prisma().agentSearch.update({ where: { id: search.id }, data: { query } });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: true, data: null });
    expect(await saveAgentSettings({ hour: 9, covers: "two-thirds", autoDraft: true, maxDrafts: 5 })).toEqual({ ok: true, data: null });
    expect(await loadSettings()).toMatchObject({ agentEnabled: true, agentHour: 9, agentCovers: "two-thirds", agentAutoDraft: true, agentMaxDrafts: 5, agentMaxScores: 15 });
    expect(await saveAgentSettings({ maxScores: 31 })).toMatchObject({ ok: false });
  });

  it("distinguishes disabled searches from missing searches and names an incomplete enabled search", async () => {
    await prisma().agentSearch.updateMany({ data: { enabled: false } });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error: "Enable an Agent search in Settings → Job agent first." });
    await prisma().agentSearch.create({ data: { name: "Missing country", query: { ...query, country: "" } } });
    expect(await saveAgentSettings({ enabled: true })).toEqual({ ok: false, error: "Choose a country for “Missing country” in Settings → Job agent first." });
  });
});

describe("recurring search actions", () => {
  it("rejects untrusted payloads without writing queries, credentials or attribution fields", async () => {
    const before = await prisma().agentSearch.findMany();
    const settings = await prisma().setting.findMany();
    for (const input of [
      { name: "Injected", query, source: "ADZUNA", apiKey: "not-a-real-secret" },
      { name: "Injected", query, candidateIds: ["foreign-candidate"] },
      { name: "Too long", query: { ...query, keywords: "x".repeat(501) } },
      { name: "x".repeat(101), query },
      { id: "x".repeat(101), name: "Invalid ID", query },
      { name: "Invalid sort", query, sort: -1 },
    ]) {
      expect(await Reflect.apply(saveRecurringSearch, undefined, [input])).toMatchObject({ ok: false });
    }
    for (const [mutate, input] of [
      [deleteRecurringSearch, { id: before[0].id, all: true }],
      [moveRecurringSearch, { id: before[0].id, direction: "up", sort: 999 }],
      [setRecurringSearchEnabled, { id: before[0].id, enabled: false, name: "Injected", query, sort: 999 }],
      [setRecurringSearchEnabled, { id: before[0].id, enabled: "false" }],
    ] as const) {
      expect(await Reflect.apply(mutate, undefined, [input])).toMatchObject({ ok: false });
    }
    expect(await prisma().agentSearch.findMany()).toEqual(before);
    expect(await prisma().setting.findMany()).toEqual(settings);
    expect(await prisma().agentCandidateSearch.count()).toBe(0);
  });

  it("authenticates every search mutation before changing data", async () => {
    const first = await prisma().agentSearch.findFirstOrThrow();
    for (const mutate of [
      () => saveRecurringSearch({ name: "New", query }),
      () => setRecurringSearchEnabled({ id: first.id, enabled: false }),
      () => deleteRecurringSearch({ id: first.id }),
      () => moveRecurringSearch({ id: first.id, direction: "down" }),
    ]) {
      vi.mocked(getSession).mockResolvedValueOnce(null);
      expect(await mutate()).toMatchObject({ ok: false });
    }
    expect(await prisma().agentSearch.count()).toBe(1);
    expect(await prisma().agentSearch.findUnique({ where: { id: first.id } })).toEqual(first);
  });

  it("toggles only enabled by id and refuses to enable the current incomplete query", async () => {
    const first = await prisma().agentSearch.findFirstOrThrow();
    const editedQuery = { ...query, keywords: "Designer", place: "Hamburg" };
    await saveRecurringSearch({ id: first.id, name: "Edited in another tab", query: editedQuery, sort: 5 });
    expect(await setRecurringSearchEnabled({ id: first.id, enabled: false })).toMatchObject({ ok: true, data: { id: first.id, name: "Edited in another tab", query: editedQuery, sort: 5, enabled: false } });
    await saveRecurringSearch({ id: first.id, name: "Needs a country", query: { ...editedQuery, country: "" }, sort: 3, enabled: false });
    expect(await setRecurringSearchEnabled({ id: first.id, enabled: true })).toEqual({ ok: false, error: "Choose a country for “Needs a country”." });
    expect(await prisma().agentSearch.findUnique({ where: { id: first.id } })).toMatchObject({ name: "Needs a country", query: { ...editedQuery, country: "" }, sort: 3, enabled: false });
    expect(await setRecurringSearchEnabled({ id: "deleted", enabled: true })).toEqual({ ok: false, error: "That Agent search no longer exists." });
  });

  it("rejects missing countries on enabled searches, invalid directions and legacy query settings", async () => {
    expect(await saveRecurringSearch({ name: "No country", query: { ...query, country: "" } })).toEqual({ ok: false, error: "Choose a country for “No country”." });
    expect(await saveRecurringSearch({ name: "Disabled draft", query: { ...query, country: "" }, enabled: false })).toMatchObject({ ok: true });
    // Untrusted callers bypass TypeScript; schema boundaries must still reject them.
    const invalidMove: unknown = { id: "one", direction: "sideways" };
    const legacySettings: unknown = { query };
    expect(await Reflect.apply(moveRecurringSearch, undefined, [invalidMove])).toMatchObject({ ok: false });
    expect(await Reflect.apply(saveAgentSettings, undefined, [legacySettings])).toMatchObject({ ok: false });
  });

  it("validates input, caps disabled searches too, edits by stable id and moves atomically", async () => {
    const first = await prisma().agentSearch.findFirstOrThrow();
    expect(await saveRecurringSearch({ name: " ", query })).toMatchObject({ ok: false });
    const second = await saveRecurringSearch({ name: "Second", query, enabled: false, sort: 1 });
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) throw new Error("create failed");
    expect(await saveRecurringSearch({ id: second.data.id, name: "Renamed", query, enabled: true, sort: 1 })).toMatchObject({ ok: true, data: { id: second.data.id, name: "Renamed" } });
    expect(await moveRecurringSearch({ id: second.data.id, direction: "up" })).toMatchObject({ ok: true, data: [{ id: second.data.id }, { id: first.id }] });
    await saveRecurringSearch({ name: "Third", query });
    expect(await saveRecurringSearch({ name: "Fourth", query })).toEqual({ ok: false, error: "Keep at most three Agent searches." });
    expect(await saveRecurringSearch({ id: "missing", name: "Gone", query })).toEqual({ ok: false, error: "That Agent search no longer exists." });
    expect(await moveRecurringSearch({ id: "missing", direction: "down" })).toEqual({ ok: false, error: "That Agent search no longer exists." });
    expect(await deleteRecurringSearch({ id: second.data.id })).toEqual({ ok: true, data: null });
    expect(await prisma().agentSearch.count()).toBe(2);
    expect(await loadSettings()).not.toHaveProperty("agentQuery");
  });
});
