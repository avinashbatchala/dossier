import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FILTERS, libraryFromParams, type FoundPosting } from "@/lib/job-search/search";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { countLibrary, fillMatchKeys, keepFound, listLibrary, markAllSeen, markSeen, movePastSearches, splitPosting, startingPoints } from "./library";
import { dismissPosting, savePosting } from "./postings";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

const now = new Date("2026-11-15T10:00:00.000Z");
const posting = (id: string, extra: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "JSEARCH",
  externalId: id,
  title: `Designer ${id}`,
  company: "Northwind",
  place: "Berlin",
  remote: null,
  salary: "",
  postedAt: "2026-11-12T00:00:00.000Z",
  url: `https://jobs.example/${id}`,
  via: "",
  description: `All of ${id}.`,
  complete: true,
  ...extra,
});
const search = (query = { keywords: "designer" }) => prisma().postingSearch.create({ data: { query }, select: { id: true } });
const ids = (shown: { externalId: string }[]) => shown.map((entry) => entry.externalId);
/** A breakdown covering `hit` of `total` requirements, all must-haves. */
const breakdown = (hit: number, total: number) => ({ factors: [], cap: null, requirements: Array.from({ length: total }, (_, index) => ({ text: `R${index}`, mustHave: true, covered: index < hit, evidence: null })) });

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("the positions library (E22-5)", () => {
  it("keeps each posting once, whichever search found it, new until it's seen", async () => {
    const first = await search();
    const second = await search({ keywords: "ux" });
    await keepFound(first.id, "JSEARCH", [posting("a"), posting("b")], { now });
    await keepFound(second.id, "JSEARCH", [posting("b", { description: "The start…", complete: false }), posting("c")], { now: new Date("2026-11-15T11:00:00Z") });

    expect(await prisma().posting.count()).toBe(3);
    // Found again: last found later, its whole text kept over a snippet.
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "b" } })).toMatchObject({ lastFoundAt: new Date("2026-11-15T11:00:00Z"), description: "All of b.", complete: true, seenAt: null });
    expect(ids((await listLibrary({ ...DEFAULT_FILTERS, found: second.id }, { now })).postings)).toEqual(["b", "c"]);
    expect(await countLibrary()).toEqual({ open: 3, new: 3, saved: 0, applied: 0, dismissed: 0, archived: 0 });
  });

  it("filters by what the user did, the portal, how recent and the score", async () => {
    const run = await search();
    await keepFound(run.id, "JSEARCH", [posting("a"), posting("b", { postedAt: "2026-09-01T00:00:00.000Z" }), posting("c")], { now });
    await keepFound(run.id, "ADZUNA", [posting("z", { source: "ADZUNA" })], { now });
    await savePosting(posting("a"));
    await dismissPosting(posting("c"));
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "b", profileId: TEST_PROFILE_ID, score: 82, reasons: [], redFlags: [], scoredWith: "test", breakdown: breakdown(2, 3) } });

    const list = async (change: Partial<typeof DEFAULT_FILTERS>) => ids((await listLibrary({ ...DEFAULT_FILTERS, ...change }, { now })).postings).toSorted();
    expect(await list({})).toEqual(["a", "b", "z"]);
    expect(await list({ show: "saved" })).toEqual(["a"]);
    expect(await list({ show: "dismissed" })).toEqual(["c"]);
    expect(await list({ show: "new" })).toEqual(["b", "z"]);
    expect(await list({ portal: "ADZUNA" })).toEqual(["z"]);
    expect(await list({ age: "week" })).toEqual(["a", "z"]);
    expect(await list({ covers: "half" })).toEqual(["b"]);
  });

  it("filters and sorts by one profile's coverage: fits Backend, covers at least half (E25-5, E32-2)", async () => {
    const run = await search();
    await keepFound(run.id, "JSEARCH", [posting("a"), posting("b"), posting("c")], { now });
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1 } });
    const score = (externalId: string, profileId: string, value: number, hit: number, total: number) =>
      prisma().postingScore.create({ data: { source: "JSEARCH", externalId, profileId, score: value, reasons: [], redFlags: [], scoredWith: "test", breakdown: breakdown(hit, total) } });
    await score("a", TEST_PROFILE_ID, 90, 3, 3);
    await score("a", backend.id, 40, 1, 4);
    await score("b", backend.id, 75, 2, 4);
    await score("c", backend.id, 85, 3, 4);

    const order = async (change: Partial<typeof DEFAULT_FILTERS>) => ids((await listLibrary({ ...DEFAULT_FILTERS, ...change }, { now })).postings);
    // Each posting's best by default; one profile's, best fit first, with Fits.
    expect((await order({ covers: "two-thirds" })).toSorted()).toEqual(["a", "c"]);
    expect(await order({ fits: backend.id })).toEqual(["c", "b", "a"]);
    expect(await order({ fits: backend.id, covers: "half" })).toEqual(["c", "b"]);
    expect(await order({ fits: TEST_PROFILE_ID, covers: "half" })).toEqual(["a"]);
    // The best score shows on the card with its profile.
    const [first] = (await listLibrary({ ...DEFAULT_FILTERS, fits: TEST_PROFILE_ID }, { now })).postings;
    expect(first.state.score).toMatchObject({ profileName: "My profile", score: 90 });
    expect(first.state.scores.map((fit) => [fit.profileName, fit.score])).toEqual([
      ["My profile", 90],
      ["Backend", 40],
    ]);
  });

  it("shows an agent run's several searches together, best fit first, from its notification's link (E26-4)", async () => {
    const one = await search();
    const two = await search();
    const other = await search();
    await keepFound(one.id, "JSEARCH", [posting("a"), posting("b")], { now });
    await keepFound(two.id, "JSEARCH", [posting("c")], { now });
    await keepFound(other.id, "JSEARCH", [posting("z")], { now });
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "c", profileId: TEST_PROFILE_ID, score: 90, reasons: [], redFlags: [], scoredWith: "test", breakdown: breakdown(3, 3) } });
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "b", profileId: TEST_PROFILE_ID, score: 60, reasons: [], redFlags: [], scoredWith: "test", breakdown: breakdown(1, 3) } });
    const filters = libraryFromParams({ found: `${one.id},${two.id}` });
    expect(ids((await listLibrary(filters, { now })).postings)).toEqual(["c", "b", "a"]);
  });

  it("pages through, saying how many there are", async () => {
    const run = await search();
    await keepFound(run.id, "JSEARCH", Array.from({ length: 55 }, (_, index) => posting(`p${index}`)), { now });
    const first = await listLibrary(DEFAULT_FILTERS, { now });
    expect([first.postings.length, first.total, first.more]).toEqual([50, 55, true]);
    const rest = await listLibrary(DEFAULT_FILTERS, { now, offset: 50 });
    expect([rest.postings.length, rest.more]).toEqual([5, false]);
  });

  it("marks one or all as seen, and a posting found again isn't new again", async () => {
    const run = await search();
    await keepFound(run.id, "JSEARCH", [posting("a"), posting("b")], { now });
    const rows = await prisma().posting.findMany({ orderBy: { externalId: "asc" } });
    await markSeen([rows[0].id], now);
    expect((await countLibrary()).new).toBe(1);
    expect(await markAllSeen(DEFAULT_FILTERS, now)).toBe(1);
    await keepFound(run.id, "JSEARCH", [posting("a")], { now: new Date("2026-11-16T00:00:00Z") });
    expect((await countLibrary()).new).toBe(0);
  });

  it("leaves a dismissed posting as it is when a search finds it again", async () => {
    const run = await search();
    await dismissPosting(posting("a"));
    await keepFound(run.id, "JSEARCH", [posting("a", { title: "Renamed" })], { now });
    expect(await prisma().posting.findFirstOrThrow()).toMatchObject({ title: "Designer a", description: "", dismissedAt: expect.any(Date) });
    expect(ids((await listLibrary(DEFAULT_FILTERS, { now })).postings)).toEqual([]);
  });

  it("moves what searches before it kept as JSON, once", async () => {
    await prisma().postingSearch.create({ data: { id: "old", source: "ADZUNA", query: { keywords: "designer" }, postings: [posting("o1", { source: "ADZUNA" })], found: 1, next: "page:2", createdAt: now } });
    expect(await movePastSearches()).toBe(1);
    expect(await movePastSearches()).toBe(0);
    expect(await prisma().postingSearch.findUniqueOrThrow({ where: { id: "old" } })).toMatchObject({ postings: [], next: null, portals: [{ id: "ADZUNA", status: "done", found: 1, next: "page:2", message: null }] });
    expect(await prisma().posting.findFirstOrThrow()).toMatchObject({ externalId: "o1", seenAt: now, lastFoundAt: now });
  });
});

describe("the same job on several portals (E22-6)", () => {
  const job = (source: string, id: string, extra: Partial<FoundPosting> = {}) =>
    posting(id, { source, company: "Northwind GmbH", title: "Product Designer (m/w/d)", place: "10115 Berlin", url: `https://${source.toLowerCase()}.example/${id}`, ...extra });

  it("shows it once, found on each portal, with what either knows", async () => {
    const first = await search();
    const second = await search({ keywords: "product designer" });
    await keepFound(first.id, "JSEARCH", [job("JSEARCH", "j1", { description: "The start…", complete: false })], { now });
    await keepFound(second.id, "ADZUNA", [job("ADZUNA", "a1", { company: "Northwind", title: "Product Designer", place: "Berlin", salary: "EUR 60,000", description: "The whole of it." })], { now: new Date("2026-11-15T12:00:00Z") });

    const { postings, total } = await listLibrary(DEFAULT_FILTERS, { now });
    expect([ids(postings), total]).toEqual([["j1"], 1]);
    expect(postings[0]).toMatchObject({ salary: "EUR 60,000", description: "The whole of it.", complete: true });
    expect(postings[0].state.foundOn).toEqual([
      { portal: "JSEARCH", url: "https://jsearch.example/j1" },
      { portal: "ADZUNA", url: "https://adzuna.example/a1" },
    ]);
    expect(await countLibrary()).toEqual({ open: 1, new: 1, saved: 0, applied: 0, dismissed: 0, archived: 0 });
    // Either portal, and the search that found it on the other, show it.
    expect(ids((await listLibrary({ ...DEFAULT_FILTERS, portal: "ADZUNA" }, { now })).postings)).toEqual(["j1"]);
    expect(ids((await listLibrary({ ...DEFAULT_FILTERS, found: second.id }, { now })).postings)).toEqual(["j1"]);
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "j1" } })).toMatchObject({ lastFoundAt: new Date("2026-11-15T12:00:00Z") });

    // Found again on the other portal, it stays merged.
    await keepFound(second.id, "ADZUNA", [job("ADZUNA", "a1", { company: "Northwind", place: "Berlin" })], { now });
    expect(ids((await listLibrary(DEFAULT_FILTERS, { now })).postings)).toEqual(["j1"]);
  });

  it("keeps a dismissed job out, whichever portal finds it next", async () => {
    const run = await search();
    await keepFound(run.id, "JSEARCH", [job("JSEARCH", "j1")], { now });
    await dismissPosting(job("JSEARCH", "j1"));
    await keepFound(run.id, "FREEHIRE", [job("FREEHIRE", "f1", { company: "Northwind" })], { now });
    expect(ids((await listLibrary(DEFAULT_FILTERS, { now })).postings)).toEqual([]);
    expect(await countLibrary()).toMatchObject({ open: 0, dismissed: 1 });
  });

  it("isn't merged across cities or levels, or with another company", async () => {
    const run = await search();
    await keepFound(run.id, "JSEARCH", [job("JSEARCH", "j1")], { now });
    await keepFound(run.id, "ADZUNA", [job("ADZUNA", "a1", { place: "Hamburg" }), job("ADZUNA", "a2", { title: "Senior Product Designer" }), job("ADZUNA", "a3", { company: "Contoso" })], { now });
    expect(ids((await listLibrary(DEFAULT_FILTERS, { now })).postings).toSorted()).toEqual(["a1", "a2", "a3", "j1"]);
  });

  it("shows them apart again on Not the same job, each with what found it, and never merges them again", async () => {
    const first = await search();
    const second = await search({ keywords: "product designer" });
    await keepFound(first.id, "JSEARCH", [job("JSEARCH", "j1")], { now });
    await keepFound(second.id, "ADZUNA", [job("ADZUNA", "a1")], { now });
    const shown = await prisma().posting.findFirstOrThrow({ where: { externalId: "j1" } });
    await markSeen([shown.id]);

    expect(await splitPosting(shown.id)).toBe(1);
    expect(await splitPosting(shown.id)).toBe(0);
    const list = (await listLibrary(DEFAULT_FILTERS, { now })).postings;
    expect(ids(list).toSorted()).toEqual(["a1", "j1"]);
    expect(list.every((entry) => entry.state.foundOn.length === 1)).toBe(true);
    expect(list.find((entry) => entry.externalId === "a1")!.state.new).toBe(true);
    expect(ids((await listLibrary({ ...DEFAULT_FILTERS, found: second.id }, { now })).postings)).toEqual(["a1"]);
    expect(ids((await listLibrary({ ...DEFAULT_FILTERS, found: first.id }, { now })).postings)).toEqual(["j1"]);

    await keepFound(second.id, "ADZUNA", [job("ADZUNA", "a1")], { now });
    expect(await listLibrary(DEFAULT_FILTERS, { now })).toMatchObject({ total: 2 });
  });

  it("gives postings from before it their company key, once", async () => {
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "old", company: "Northwind GmbH", title: "Product Designer" } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "none", company: "" } });
    expect(await fillMatchKeys(prisma())).toBe(1);
    expect(await fillMatchKeys(prisma())).toBe(0);
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "old" } })).toMatchObject({ matchCompany: "northwind" });
  });
});

describe("starting points for New application (E31-2)", () => {
  it("offers saved postings and the agent's finds of the last week, newest first, with their coverage", async () => {
    const mine = await search();
    const agent = await prisma().postingSearch.create({ data: { query: { keywords: "designer" }, agentSearchName: "Design" }, select: { id: true } });
    await keepFound(mine.id, "JSEARCH", [posting("saved"), posting("plain")], { now: new Date("2026-11-10T09:00:00Z") });
    await keepFound(agent.id, "JSEARCH", [posting("found")], { now: new Date("2026-11-15T07:00:00Z") });
    await keepFound(agent.id, "JSEARCH", [posting("old")], { now: new Date("2026-11-01T07:00:00Z") });
    await keepFound(agent.id, "JSEARCH", [posting("gone")], { now: new Date("2026-11-15T08:00:00Z") });
    await savePosting(posting("saved"));
    await prisma().posting.update({ where: { source_externalId: { source: "JSEARCH", externalId: "saved" } }, data: { savedAt: new Date("2026-11-13T09:00:00Z") } });
    await dismissPosting(posting("gone"));
    await prisma().postingScore.create({
      data: {
        source: "JSEARCH",
        externalId: "found",
        profileId: TEST_PROFILE_ID,
        score: 88,
        reasons: [],
        redFlags: [],
        scoredWith: "test",
        breakdown: { factors: [], cap: null, requirements: [{ text: "Figma", mustHave: true, covered: true, evidence: null }, { text: "Dutch", mustHave: false, covered: false, evidence: null }] },
      },
    });

    const points = await startingPoints({ now });
    expect(points.map((point) => [point.title, point.from, point.hit, point.total])).toEqual([
      ["Designer found", "agent", 1, 2],
      ["Designer saved", "saved", 0, 0],
    ]);
  });
});
