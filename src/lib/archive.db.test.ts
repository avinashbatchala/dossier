import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FILTERS, type FoundPosting } from "@/lib/job-search/search";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { archiveUntouched, moveBack, removeArchived } from "./archive";
import { countLibrary, keepFound, libraryIds, listLibrary } from "./library";
import { dismissPosting, savePosting } from "./postings";
import { saveSettings } from "./settings-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

const now = new Date("2026-11-15T10:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const posting = (id: string, extra: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "JSEARCH",
  externalId: id,
  title: `Designer ${id}`,
  company: `Company ${id}`,
  place: "Berlin",
  remote: null,
  salary: "",
  postedAt: null,
  url: `https://jobs.example/${id}`,
  via: "",
  description: `All of ${id}.`,
  complete: true,
  ...extra,
});
const ARCHIVE = { ...DEFAULT_FILTERS, tab: "archive" as const };
const ids = async (filters = DEFAULT_FILTERS) => (await listLibrary(filters, { now })).postings.map((entry) => entry.externalId).toSorted();
const rowOf = (externalId: string) => prisma().posting.findFirstOrThrow({ where: { externalId } });

/** Found by a search `days` ago. */
async function found(days: number, ...postings: FoundPosting[]) {
  const search = await prisma().postingSearch.create({ data: { query: { keywords: "designer" } }, select: { id: true } });
  await keepFound(search.id, "JSEARCH", postings, { now: daysAgo(days) });
  return search.id;
}

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("the Archive (E22-7)", () => {
  it("takes postings nobody touched, the days after a search last found them", async () => {
    await found(40, posting("old"), posting("saved"), posting("dismissed"), posting("applied"), posting("scored"));
    await found(10, posting("recent"));
    await savePosting(posting("saved"));
    await dismissPosting(posting("dismissed"));
    // Applied for from the same link, before Positions linked it.
    await prisma().application.create({ data: { company: "Company applied", role: "Designer", postingUrl: "https://jobs.example/applied?utm_source=x" } });
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "scored", profileId: TEST_PROFILE_ID, score: 80, reasons: [], redFlags: [], scoredWith: "test" } });

    expect(await archiveUntouched({ now, days: 30 })).toBe(2);
    expect(await ids(ARCHIVE)).toEqual(["old", "scored"]);
    expect(await ids()).toEqual(["applied", "recent", "saved"]);
    // "applied" counts under Applied for: an application from its link (E32-3).
    expect(await countLibrary()).toEqual({ open: 3, new: 2, saved: 1, applied: 1, dismissed: 1, archived: 2 });
    // Its score stays with it.
    expect((await listLibrary(ARCHIVE, { now })).postings.find((entry) => entry.externalId === "scored")!.state.score).toMatchObject({ score: 80 });
    expect(await archiveUntouched({ now, days: 30 })).toBe(0);
  });

  it("waits as long as Settings says", async () => {
    await found(40, posting("old"));
    await saveSettings({ archiveAfterDays: 60 });
    expect(await archiveUntouched({ now })).toBe(0);
    await saveSettings({ archiveAfterDays: 14 });
    expect(await archiveUntouched({ now })).toBe(1);
  });

  it("keeps one a search finds again there, still listed and not new", async () => {
    const search = await found(40, posting("old"));
    await archiveUntouched({ now, days: 30 });
    const later = new Date(now.getTime() + 3_600_000);
    await keepFound(search, "JSEARCH", [posting("old", { title: "Designer, renamed" })], { now: later });

    const [shown] = (await listLibrary(ARCHIVE, { now })).postings;
    expect(shown).toMatchObject({ title: "Designer, renamed", state: { archived: true, stillListedAt: later.toISOString() } });
    expect(await countLibrary()).toMatchObject({ open: 0, new: 0, archived: 1 });
  });

  it("moves one back, where the days start over", async () => {
    await found(40, posting("old"));
    await archiveUntouched({ now, days: 30 });
    const row = await rowOf("old");
    expect(await moveBack([row.id], { now })).toBe(1);
    expect(await ids()).toEqual(["old"]);
    expect(await rowOf("old")).toMatchObject({ archivedAt: null, seenAt: now });
    expect(await archiveUntouched({ now, days: 30 })).toBe(0);
    expect(await archiveUntouched({ now: new Date(now.getTime() + 31 * 86_400_000), days: 30 })).toBe(1);
  });

  it("removes one for good: trimmed, shown nowhere, and no search brings it back", async () => {
    const search = await found(40, posting("old"), posting("other"));
    await archiveUntouched({ now, days: 30 });
    expect(await removeArchived([(await rowOf("old")).id], { now })).toBe(1);
    expect(await rowOf("old")).toMatchObject({ removedAt: now, description: "" });
    await keepFound(search, "JSEARCH", [posting("old")], { now });
    expect(await rowOf("old")).toMatchObject({ description: "" });
    expect([await ids(), await ids(ARCHIVE)]).toEqual([[], ["other"]]);
    expect(await countLibrary()).toMatchObject({ archived: 1, dismissed: 0 });
  });

  it("removes all the filters show, and only from the Archive", async () => {
    await found(40, posting("j1"), posting("a1", { source: "ADZUNA" }));
    await found(1, posting("fresh", { source: "ADZUNA" }));
    await archiveUntouched({ now, days: 30 });
    const adzuna = await libraryIds({ ...ARCHIVE, portal: "ADZUNA" }, { now });
    expect(await removeArchived(adzuna, { now })).toBe(1);
    expect(await removeArchived([(await rowOf("fresh")).id], { now })).toBe(0);
    expect([await ids(), await ids(ARCHIVE)]).toEqual([["fresh"], ["j1"]]);
  });

  it("lets go of one that's saved, dismissed or applied for", async () => {
    await found(40, posting("old"));
    await archiveUntouched({ now, days: 30 });
    await savePosting(posting("old"));
    expect(await rowOf("old")).toMatchObject({ archivedAt: null, savedAt: expect.any(Date) });
    expect(await countLibrary()).toMatchObject({ saved: 1, archived: 0 });
  });
});
