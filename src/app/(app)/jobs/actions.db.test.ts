import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { clearJobSearchCache } from "@/lib/job-search/cache";
import { EMPTY_QUERY, type FoundPosting } from "@/lib/job-search/search";
import { encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";
import { jsearchV2LastPage } from "@/test/job-search-fixtures";

import {
  dismissFoundPosting,
  loadFullText,
  removeJobSearch,
  restorePosting,
  runJobSearch,
  savePostingForLater,
  showMorePostings,
  startApplicationFrom,
  startScoringPosting,
  unsavePosting,
} from "./actions";

// The actions run against the test database, signed in.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
const ai = vi.hoisted(() => ({ ready: true }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => ai.ready }));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "score-job"),
}));
const prisma = () => db.client!;

const posting: FoundPosting = {
  source: "JSEARCH",
  externalId: "job-1",
  title: "UX Researcher",
  company: "Northwind Studio",
  place: "Berlin",
  remote: true,
  salary: "",
  postedAt: null,
  url: "https://jobs.example/1",
  via: "Indeed",
  description: "The whole posting.",
  complete: true,
};
const query = { ...EMPTY_QUERY, keywords: "researcher", country: "de" };

beforeEach(async () => {
  ai.ready = true;
  await resetDatabase(prisma());
  clearJobSearchCache();
  await saveSettings({ jobSource: "JSEARCH", jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_test") });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => prisma().$disconnect());

describe("Find jobs actions", () => {
  it("runs a search and keeps it, adds its next page, and removes it (E14-10)", async () => {
    stubFetch(() => json({ ...jsearchV2LastPage, data: { ...jsearchV2LastPage.data, cursor: "MORE" } }));
    const run = await runJobSearch({ query });
    expect(run).toEqual({ ok: true, data: { ok: true, id: expect.any(String) } });
    const id = run.ok && run.data.ok ? run.data.id : "";

    stubFetch(() => json(jsearchV2LastPage));
    expect(await showMorePostings({ searchId: id })).toEqual({ ok: true, data: { ok: true, postings: [], next: null } });

    expect(await removeJobSearch({ id })).toEqual({ ok: true, data: null, toast: "Search removed. Saved postings from it stay in Saved." });
    expect(await prisma().postingSearch.count()).toBe(0);
  });

  it("says why a search didn't run", async () => {
    expect(await runJobSearch({ query: { ...query, country: "" } })).toMatchObject({ ok: true, data: { ok: false, problem: "no-country" } });
    expect(await runJobSearch({ query: { ...query, radiusKm: 33 as never } })).toMatchObject({ ok: false });
  });

  it("saves, dismisses and brings back a posting, with a toast where one helps", async () => {
    expect(await savePostingForLater({ posting })).toEqual({ ok: true, data: { postingId: expect.any(String) }, toast: "Saved for later." });
    expect(await dismissFoundPosting({ posting })).toEqual({ ok: true, data: { wasSaved: true } });
    expect(await restorePosting({ source: "JSEARCH", externalId: "job-1", saved: true })).toEqual({ ok: true, data: null });
    expect(await prisma().posting.findFirstOrThrow()).toMatchObject({ savedAt: expect.any(Date), dismissedAt: null });
    expect(await unsavePosting({ source: "JSEARCH", externalId: "job-1" })).toEqual({ ok: true, data: null, toast: "Removed from Saved." });
    expect(await prisma().posting.count()).toBe(0);
  });

  it("refuses postings with links that aren't web addresses", async () => {
    expect(await savePostingForLater({ posting: { ...posting, url: "javascript:alert(1)" } })).toMatchObject({ ok: false });
  });

  it("gives a complete posting's text back as it is", async () => {
    expect(await loadFullText({ posting })).toEqual({ ok: true, data: { text: "The whole posting." } });
  });

  it("keeps the posting when an application is started from it, with whatever text there is", async () => {
    const started = await startApplicationFrom({ posting });
    expect(started).toEqual({ ok: true, data: { postingId: expect.any(String) } });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: started.ok ? started.data.postingId : "" } })).toMatchObject({
      description: "The whole posting.",
      complete: true,
      savedAt: null,
      applicationId: null,
    });

    // Only the start, and no way to get the rest: kept as it is.
    const partial = { ...posting, externalId: "job-2", description: "The start…", complete: false };
    await saveSettings({ jsearchKeyEnc: null });
    const second = await startApplicationFrom({ posting: partial });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: second.ok ? second.data.postingId : "" } })).toMatchObject({
      description: "The start…",
      complete: false,
    });
  });
});

describe("Score (#208)", () => {
  it("scores a posting in the background, and follows a scoring already under way", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    expect(await startScoringPosting({ posting })).toEqual({ ok: true, data: { jobId: "score-job" } });
    expect(startJob).toHaveBeenLastCalledWith(expect.objectContaining({ type: "posting-score" }), { posting }, { key: "posting-score:JSEARCH:job-1" });
    const running = await prisma().job.create({ data: { type: "posting-score", key: "posting-score:JSEARCH:job-1", status: "RUNNING", input: { posting } } });
    expect(await startScoringPosting({ posting })).toEqual({ ok: true, data: { jobId: running.id } });
  });

  it("says when there's no AI provider to score with", async () => {
    ai.ready = false;
    expect(await startScoringPosting({ posting })).toEqual({ ok: false, error: "Choose an AI provider in Settings → AI provider first." });
  });
});
