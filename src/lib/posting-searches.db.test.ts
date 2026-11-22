import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { clearJobSearchCache } from "@/lib/job-search/cache";
import { fullText } from "@/lib/job-search/find";
import { EMPTY_QUERY, portalsLine } from "@/lib/job-search/search";
import { startJob } from "@/lib/jobs/runner";
import { savePosting } from "@/lib/postings";
import { encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";
import { jsearchV2LastPage, jsearchV2Page } from "@/test/job-search-fixtures";

import { movePastSearches } from "./library";
import { countSearches, listSearches, loadSearch, removeSearch, retryPortal, runSearch, showMoreFor } from "./posting-searches";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
// The background search is started, not run: the tests that want results wait for them (E22-4).
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/jobs/runner")>()), startJob: vi.fn(async () => "job-1") }));
const prisma = () => db.client!;

const query = { ...EMPTY_QUERY, keywords: "product designer", place: "Hamburg", country: "de" };
const useJSearch = () =>
  saveSettings({ portals: { JSEARCH: { on: true, fields: {}, acceptedAt: null } }, portalKeysEnc: { JSEARCH: { key: encryptSecret(JOB_SOURCE_KEY, "ak_test") } } });

beforeEach(async () => {
  await resetDatabase(prisma());
  clearJobSearchCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => prisma().$disconnect());

describe("runSearch (E22-4)", () => {
  const portalsOfSearch = async (id: string) => (await prisma().postingSearch.findUniqueOrThrow({ where: { id } })).portals;

  it("needs a portal switched on and a country", async () => {
    expect(await runSearch(query)).toEqual({ ok: false, problem: "off", message: "Switch on a portal in Settings → Job search first." });
    await useJSearch();
    expect(await runSearch({ ...query, country: "" })).toMatchObject({ ok: false, problem: "no-country" });
    expect(await countSearches()).toBe(0);
  });

  it("keeps the search with each portal's first page, in the library", async () => {
    await useJSearch();
    const requests = stubFetch(() => json(jsearchV2Page));
    const result = await runSearch(query, { wait: true });
    expect(result).toEqual({ ok: true, id: expect.any(String) });
    expect(requests[0].headers.get("x-api-key")).toBe("ak_test");
    const kept = await prisma().postingSearch.findUniqueOrThrow({ where: { id: result.ok ? result.id : "" } });
    expect(kept).toMatchObject({ source: null, query, found: 2, portals: [{ id: "JSEARCH", status: "done", found: 2, next: "cursor:CURSOR-PAGE-2", message: null }] });
    // What it found is in the library, new, linked to the search (E22-5).
    expect(await prisma().posting.findMany({ select: { seenAt: true } })).toEqual([{ seenAt: null }, { seenAt: null }]);
    expect(await prisma().postingFind.count({ where: { searchId: kept.id } })).toBe(2);
  });

  it("asks every portal switched on, skipping one that doesn't cover the country, and one failing never fails the rest", async () => {
    await saveSettings({
      portals: { JSEARCH: { on: true, fields: {}, acceptedAt: null }, FREEHIRE: { on: true, fields: {}, acceptedAt: null }, ADZUNA: { on: true, fields: { appId: "a" }, acceptedAt: null } },
      portalKeysEnc: { JSEARCH: { key: encryptSecret(JOB_SOURCE_KEY, "ak_test") } },
    });
    stubFetch((request) => (request.url.hostname === "freehire.me" ? json({}, { status: 503 }) : json(jsearchV2Page)));
    // Adzuna doesn't list jobs in Peru; JSearch and FreeHire do.
    const result = await runSearch({ ...query, country: "pe" }, { wait: true });
    const portals = await portalsOfSearch(result.ok ? result.id : "");
    expect(portals).toEqual([
      { id: "JSEARCH", status: "done", found: 2, next: "cursor:CURSOR-PAGE-2", message: null },
      { id: "ADZUNA", status: "skipped", found: 0, next: null, message: "Adzuna doesn't cover Peru." },
      // What kind of problem it was, for Settings' status (E34-1).
      { id: "FREEHIRE", status: "failed", found: 0, next: null, message: "FreeHire isn't answering right now. Try again in a minute.", problem: "unavailable" },
    ]);
    expect(portalsLine(portals as never)).toBe("1 of 2 portals answered · 1 failed · 1 skipped");
  });

  it("says when no portal switched on covers the country", async () => {
    await saveSettings({ portals: { ADZUNA: { on: true, fields: {}, acceptedAt: null } } });
    expect(await runSearch({ ...query, country: "pe" })).toMatchObject({ ok: false, problem: "country", message: expect.stringContaining("Peru") });
    expect(await countSearches()).toBe(0);
  });

  it("says what's missing for a portal without its key, out of searches, or not answering", async () => {
    await saveSettings({ portals: { JSEARCH: { on: true, fields: {}, acceptedAt: null } } });
    let result = await runSearch(query, { wait: true });
    expect(await portalsOfSearch(result.ok ? result.id : "")).toMatchObject([{ status: "failed", message: "Add your JSearch key in Settings → Job search first." }]);

    await useJSearch();
    stubFetch(() => json({}, { status: 429 }));
    result = await runSearch(query, { wait: true });
    expect(await portalsOfSearch(result.ok ? result.id : "")).toMatchObject([{ status: "skipped", message: expect.stringContaining("used up your JSearch searches") }]);

    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => {
      throw new Error("boom");
    });
    result = await runSearch(query, { wait: true });
    expect(await portalsOfSearch(result.ok ? result.id : "")).toMatchObject([{ status: "failed", message: expect.stringContaining("isn't answering") }]);
  });

  it("starts in the background without wait, and Try again asks a failed portal again", async () => {
    await useJSearch();
    const result = await runSearch(query);
    const id = result.ok ? result.id : "";
    expect(await portalsOfSearch(id)).toEqual([{ id: "JSEARCH", status: "waiting", found: 0, next: null, message: null }]);
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ type: "portal-search" }), { searchId: id, portals: ["JSEARCH"], more: false }, { key: `search:${id}` });

    // No job is doing it (the runner is stubbed here, as after a restart): it shows as stopped, and can be tried again.
    expect((await loadSearch(id))!.portals).toEqual([{ id: "JSEARCH", status: "failed", found: 0, next: null, message: "Dossier stopped before it answered. Try again." }]);
    await prisma().postingSearch.update({ where: { id }, data: { portals: [{ id: "JSEARCH", status: "done", found: 2, next: null, message: null }] } });
    expect(await retryPortal(id, "JSEARCH")).toBe(false);
    await prisma().postingSearch.update({ where: { id }, data: { portals: [{ id: "JSEARCH", status: "failed", found: 0, next: null, message: "Down." }] } });
    expect(await retryPortal(id, "JSEARCH")).toBe(true);
    expect(await portalsOfSearch(id)).toEqual([{ id: "JSEARCH", status: "waiting", found: 0, next: null, message: null }]);
    expect(startJob).toHaveBeenLastCalledWith(expect.anything(), { searchId: id, portals: ["JSEARCH"], more: false }, { key: `search:${id}` });
  });
});

describe("loadSearch", () => {
  it("opens a kept search without asking the source, with where each posting stands now", async () => {
    await useJSearch();
    stubFetch(() => json(jsearchV2Page));
    const run = await runSearch(query, { wait: true });
    const requests = stubFetch(() => json(jsearchV2Page));

    const now = new Date();
    const search = await loadSearch(run.ok ? run.id : "", { now });
    expect(requests).toHaveLength(0);
    expect(search).toMatchObject({ source: "JSEARCH", query, next: "cursor:CURSOR-PAGE-2", ranAt: expect.stringMatching(/^today at \d\d:\d\d$/) });
    expect(search!.postings.map((posting) => [posting.title, posting.state.saved])).toEqual([
      ["Senior Product Designer, Payments", false],
      ["UX Researcher", false],
    ]);

    const { state, ...ledgerly } = search!.postings[0];
    void state;
    await savePosting(ledgerly);
    expect((await loadSearch(search!.id))!.postings[0].state.saved).toBe(true);
  });

  it("opens the latest search without an id, and nothing when there's none or it's gone", async () => {
    expect(await loadSearch()).toBeNull();
    await prisma().postingSearch.create({ data: { source: "JSEARCH", query, postings: [], createdAt: new Date("2026-10-01T10:00:00Z") } });
    const latest = await prisma().postingSearch.create({ data: { source: "JSEARCH", query: { ...query, keywords: "researcher" }, postings: [] } });
    expect((await loadSearch())?.id).toBe(latest.id);
    expect(await loadSearch("gone")).toBeNull();
  });

  it("reads past an old posting that no longer fits, and a damaged search", async () => {
    const search = await prisma().postingSearch.create({
      data: { source: "ADZUNA", query: { keywords: 1 }, postings: [{ title: "No id" }, ...jsearchV2LastPage.data.jobs.map(() => ({ ...EMPTY_POSTING }))] },
      select: { id: true },
    });
    // A search from before E22-5 kept what it found as JSON: moved into the library once, at start.
    expect(await movePastSearches()).toBe(1);
    expect(await movePastSearches()).toBe(0);
    expect(await loadSearch(search.id, { now: new Date() })).toMatchObject({ query: EMPTY_QUERY, postings: [expect.objectContaining({ externalId: "kept" })] });
    // Seen: it was shown back then.
    expect(await prisma().posting.findFirstOrThrow()).toMatchObject({ externalId: "kept", seenAt: expect.any(Date) });
    const damaged = await prisma().postingSearch.create({ data: { source: "ADZUNA", query, postings: { not: "a list" } }, select: { id: true } });
    await movePastSearches();
    expect((await loadSearch(damaged.id))!.postings).toEqual([]);
  });

  it("says when it ran: yesterday, or the day", async () => {
    const yesterday = await prisma().postingSearch.create({ data: { source: "JSEARCH", query, postings: [], createdAt: new Date("2026-10-02T16:20:00Z") } });
    const older = await prisma().postingSearch.create({ data: { source: "JSEARCH", query, postings: [], createdAt: new Date("2026-09-28T08:05:00Z") } });
    const now = new Date("2026-10-03T12:00:00Z");
    expect((await loadSearch(yesterday.id, { timeZone: "Europe/Berlin", now }))!.ranAt).toBe("yesterday at 18:20");
    expect((await loadSearch(older.id, { timeZone: "Europe/Berlin", now }))!.ranAt).toBe("on Mon 28 Sep at 10:05");
  });
});

const EMPTY_POSTING = {
  source: "JSEARCH",
  externalId: "kept",
  title: "Kept",
  company: "",
  place: "",
  remote: null,
  salary: "",
  postedAt: null,
  url: "",
  via: "",
  description: "",
  complete: false,
};

describe("a search from a source that's no longer listed (#269)", () => {
  it("still opens with what it found, under the stored id, without Show more", async () => {
    const posting = { ...EMPTY_POSTING, source: "GONE_BOARD", externalId: "gone-1", title: "Designer" };
    const search = await prisma().postingSearch.create({ data: { source: "GONE_BOARD", query, postings: [posting], found: 1, next: "page:2" }, select: { id: true } });
    await movePastSearches();
    const requests = stubFetch(() => json({}));

    expect(await loadSearch(search.id)).toMatchObject({ source: "GONE_BOARD", next: null, postings: [expect.objectContaining({ source: "GONE_BOARD", externalId: "gone-1" })] });
    expect((await listSearches()).flatMap((day) => day.searches)).toEqual([expect.objectContaining({ id: search.id, source: "GONE_BOARD" })]);
    expect(await showMoreFor(search.id)).toEqual({ ok: true, postings: [], next: null });
    expect(await fullText({ ...posting, complete: false })).toBeNull();
    expect(requests).toHaveLength(0);
  });
});

describe("showMoreFor", () => {
  it("adds the next page to the kept search, once each, from the search's own source", async () => {
    await useJSearch();
    stubFetch(() => json(jsearchV2Page));
    const run = await runSearch(query, { wait: true });
    const id = run.ok ? run.id : "";
    // The user switched portals meanwhile: the search goes on with its own.
    await saveSettings({ portals: { JSEARCH: { on: false, fields: {}, acceptedAt: null }, ARBEITSAGENTUR: { on: true, fields: {}, acceptedAt: "2026-10-01T00:00:00.000Z" } } });

    const requests = stubFetch(() => json(jsearchV2LastPage));
    const more = await showMoreFor(id, { wait: true });
    expect(requests[0].url.searchParams.get("cursor")).toBe("CURSOR-PAGE-2");
    // UX Researcher was on the first page already.
    expect(more).toEqual({ ok: true, postings: [], next: null });
    expect(await prisma().postingSearch.findUniqueOrThrow({ where: { id } })).toMatchObject({ found: 2, portals: [{ id: "JSEARCH", next: null }] });

    // The last page: nothing more to ask.
    expect(await showMoreFor(id, { wait: true })).toEqual({ ok: true, postings: [], next: null });
    expect(requests).toHaveLength(1);
  });

  it("adds new postings with where they stand", async () => {
    await useJSearch();
    stubFetch(() => json(jsearchV2LastPage));
    const run = await runSearch({ ...query, keywords: "researcher" }, { wait: true });
    const id = run.ok ? run.id : "";
    await prisma().postingSearch.update({ where: { id }, data: { portals: [{ id: "JSEARCH", status: "done", found: 1, next: "cursor:MORE", message: null }] } });
    stubFetch(() => json(jsearchV2Page));
    const more = await showMoreFor(id, { wait: true });
    expect(more).toMatchObject({ ok: true, next: "cursor:CURSOR-PAGE-2", postings: [expect.objectContaining({ title: "Senior Product Designer, Payments", state: expect.objectContaining({ saved: false }) })] });
    expect((await prisma().postingSearch.findUniqueOrThrow({ where: { id } })).found).toBe(2);
  });

  it("says when the search is gone, or the source says no", async () => {
    expect(await showMoreFor("gone")).toMatchObject({ ok: false, message: "That search is no longer kept. Search again." });
    await useJSearch();
    stubFetch(() => json(jsearchV2Page));
    const run = await runSearch(query, { wait: true });
    stubFetch(() => json({}, { status: 429 }));
    expect(await showMoreFor(run.ok ? run.id : "", { wait: true })).toMatchObject({ ok: false, problem: "quota" });
  });
});

describe("listSearches and removeSearch", () => {
  it("lists kept searches newest first, grouped by the day they ran in the user's time zone", async () => {
    const at = (iso: string, keywords: string) =>
      prisma().postingSearch.create({ data: { source: "JSEARCH", query: { ...query, keywords }, postings: [], found: 3, createdAt: new Date(iso) } });
    await at("2026-10-03T09:30:00Z", "designer");
    await at("2026-10-02T22:30:00Z", "researcher"); // Already the 3rd in Berlin.
    await at("2026-10-02T10:00:00Z", "writer");
    await at("2026-09-28T08:00:00Z", "nurse");

    const days = await listSearches({ timeZone: "Europe/Berlin", now: new Date("2026-10-03T12:00:00Z") });
    expect(days.map((day) => [day.day, day.searches.map((search) => [search.time, search.query.keywords, search.found])])).toEqual([
      ["Today", [["11:30", "designer", 3], ["00:30", "researcher", 3]]],
      ["Yesterday", [["12:00", "writer", 3]]],
      ["Mon 28 Sep", [["10:00", "nurse", 3]]],
    ]);
    expect(await countSearches()).toBe(4);
  });

  it("removes a search, and leaves saved postings alone", async () => {
    const search = await prisma().postingSearch.create({ data: { source: "JSEARCH", query, postings: [EMPTY_POSTING] } });
    await savePosting({ ...EMPTY_POSTING, source: "JSEARCH" });
    await removeSearch(search.id);
    await removeSearch("gone");
    expect(await countSearches()).toBe(0);
    expect(await prisma().posting.count()).toBe(1);
  });
});

describe("fullText", () => {
  it("returns a complete posting's own text, and asks the posting's own source for the rest", async () => {
    await useJSearch();
    stubFetch(() => json(jsearchV2Page));
    const run = await runSearch(query, { wait: true });
    const { state, ...posting } = (await loadSearch(run.ok ? run.id : ""))!.postings[0];
    void state;
    expect(await fullText(posting)).toBe(posting.description);
    expect(await fullText({ ...posting, complete: false })).toBe(posting.description);
  });

  it("gives up quietly without the source's key", async () => {
    expect(await fullText({ ...EMPTY_POSTING, source: "JSEARCH", complete: false })).toBeNull();
  });
});
