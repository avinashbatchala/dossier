import "server-only";

import type { Posting, Prisma } from "@/generated/prisma/client";
import {
  DEFAULT_FILTERS,
  FOUND_BY_AGENT,
  foundSearchIds,
  foundPostingSchema,
  POSTED_WITHIN,
  postingKey,
  searchPortalSchema,
  type FoundPosting,
  type LibraryFilters,
  type SearchPortal,
  type ShownPosting,
} from "@/lib/job-search/search";
import { companyKey, sameJob } from "@/lib/dedupe";
import { foundFromPosting, postingStates } from "@/lib/postings";
import { byBestFit, coverageOf, passes } from "@/lib/posting-coverage";
import { prisma } from "@/lib/prisma";

// The positions library (E22-5, #391): every posting a search finds, kept
// once, whichever search and portal found it. A search keeps which postings
// it found (PostingFind); the library is the one list Positions shows, with
// its filters. Dismissed postings stay, trimmed, so they never come back.
// The same job found on another portal is merged into the one already there
// (E22-6, #392): it shows once, found on both.

type Db = Prisma.TransactionClient | typeof prisma;

/** How many postings the list shows at a time. */
const LIBRARY_PAGE = 50;

function fieldsOf(found: FoundPosting) {
  return {
    title: found.title,
    company: found.company,
    place: found.place,
    remote: found.remote,
    salary: found.salary,
    postedAt: found.postedAt ? new Date(found.postedAt) : null,
    url: found.url,
    via: found.via,
  };
}

/**
 * Keeps what a search found on a portal: each posting in the library once,
 * new until it's seen, and refreshed when it's found again (a whole
 * description isn't replaced by a snippet, and a dismissed one stays as it
 * is); and that this search found it, in order.
 */
export async function keepFound(
  searchId: string,
  portal: string,
  found: readonly FoundPosting[],
  options: { now?: Date; seenAt?: Date | null; db?: Db } = {},
): Promise<void> {
  // Inside a transaction (an import) it runs as it is; otherwise one at a time, since portals answer at once
  // and the same job from two of them must find the other already there to merge (E22-6).
  if (options.db && options.db !== prisma) return keep(searchId, portal, found, options);
  const turn = keeping.then(() => keep(searchId, portal, found, options));
  keeping = turn.catch(() => {});
  return turn;
}

/** The last keepFound under way, which the next one waits for. */
let keeping: Promise<unknown> = Promise.resolve();

async function keep(
  searchId: string,
  portal: string,
  found: readonly FoundPosting[],
  { now = new Date(), seenAt = null, db = prisma }: { now?: Date; seenAt?: Date | null; db?: Db },
): Promise<void> {
  for (const posting of found) {
    const where = { source_externalId: { source: posting.source, externalId: posting.externalId } };
    const existing = await db.posting.findUnique({ where, select: { id: true, complete: true, dismissedAt: true, removedAt: true, lastFoundAt: true, mergedIntoId: true } });
    const keys = { matchCompany: companyKey(posting.company) };
    let id: string;
    // The posting that shows: this one, or the one it's the same job as (E22-6).
    let shown: string;
    if (!existing) {
      const same = await sameJobAs(posting, db);
      id = (
        await db.posting.create({
          data: { source: posting.source, externalId: posting.externalId, ...fieldsOf(posting), ...keys, description: posting.description, complete: posting.complete, lastFoundAt: now, seenAt, mergedIntoId: same },
          select: { id: true },
        })
      ).id;
      shown = same ?? id;
    } else {
      id = existing.id;
      shown = existing.mergedIntoId ?? id;
      const later = existing.lastFoundAt < now ? { lastFoundAt: now } : {};
      const text = existing.complete && !posting.complete ? {} : { description: posting.description, complete: posting.complete };
      // Dismissed or removed from the Archive, it stays as it is; archived, it stays there, found again (E22-7).
      await db.posting.update({ where: { id }, data: existing.dismissedAt || existing.removedAt ? later : { ...fieldsOf(posting), ...keys, ...text, ...later } });
    }
    if (shown !== id) await fillIn(shown, posting, now, db);
    await db.postingFind.upsert({
      where: { postingId_searchId: { postingId: shown, searchId } },
      create: { postingId: shown, searchId, portal, foundAt: now },
      update: {},
    });
  }
}

/**
 * The posting a new one is the same job as (E22-6), or null: the first of
 * those that show (not merged into another) at the same company that the
 * layers in src/lib/dedupe.ts match. One split from it ("Not the same job")
 * already has a row, so it's never compared again.
 */
async function sameJobAs(posting: FoundPosting, db: Db): Promise<string | null> {
  const company = companyKey(posting.company);
  if (!company) return null;
  const candidates = await db.posting.findMany({
    where: { matchCompany: company, mergedIntoId: null },
    select: { id: true, url: true, company: true, title: true, place: true, remote: true, description: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return candidates.find((candidate) => sameJob(posting, candidate) !== null)?.id ?? null;
}

/**
 * The posting that shows, found again through one merged into it: found
 * now, and given what it lacks that the other has (the whole text, a salary,
 * when it was posted), unless it's dismissed.
 */
async function fillIn(shownId: string, other: FoundPosting, now: Date, db: Db): Promise<void> {
  const shown = await db.posting.findUnique({ where: { id: shownId }, select: { complete: true, description: true, salary: true, postedAt: true, remote: true, dismissedAt: true, removedAt: true, lastFoundAt: true } });
  if (!shown) return;
  const data: Prisma.PostingUpdateInput = shown.lastFoundAt < now ? { lastFoundAt: now } : {};
  if (!shown.dismissedAt && !shown.removedAt) {
    if (!shown.complete && (other.complete || other.description.length > shown.description.length)) Object.assign(data, { description: other.description, complete: other.complete });
    if (!shown.salary && other.salary) data.salary = other.salary;
    if (!shown.postedAt && other.postedAt) data.postedAt = new Date(other.postedAt);
    if (shown.remote === null && other.remote !== null) data.remote = other.remote;
  }
  if (Object.keys(data).length > 0) await db.posting.update({ where: { id: shownId }, data });
}

/**
 * Gives postings stored before E22-6 the keys they're compared by, once; at
 * start and after an import. They aren't merged after the fact: only what's
 * found from now on is.
 */
export async function fillMatchKeys(db: Db = prisma): Promise<number> {
  const rows = await db.posting.findMany({ where: { matchCompany: "", company: { not: "" } }, select: { id: true, company: true } });
  let filled = 0;
  for (const row of rows) {
    const matchCompany = companyKey(row.company);
    if (!matchCompany) continue;
    await db.posting.update({ where: { id: row.id }, data: { matchCompany } });
    filled++;
  }
  return filled;
}

/**
 * "Not the same job": the postings merged into this one show on their own
 * again, new, each with the searches that found it on its portal. Each has
 * a row of its own, so it's never merged again. Gives how many.
 */
export async function splitPosting(postingId: string, db: Db = prisma): Promise<number> {
  const shown = await db.posting.findUnique({ where: { id: postingId }, select: { id: true, source: true, merged: { select: { id: true, source: true } } } });
  if (!shown || shown.merged.length === 0) return 0;
  for (const other of shown.merged) {
    await db.posting.update({ where: { id: other.id }, data: { mergedIntoId: null, seenAt: null } });
    // What the other's portal found goes with it; when both are from one portal, its searches found both.
    const finds = await db.postingFind.findMany({ where: { postingId: shown.id, portal: other.source } });
    for (const find of finds) {
      if (other.source !== shown.source) await db.postingFind.delete({ where: { id: find.id } });
      await db.postingFind.upsert({
        where: { postingId_searchId: { postingId: other.id, searchId: find.searchId } },
        create: { postingId: other.id, searchId: find.searchId, portal: find.portal, foundAt: find.foundAt },
        update: {},
      });
    }
  }
  return shown.merged.length;
}

/** The portals a search asked, read back; an entry that no longer fits is left out. */
export function portalsOf(value: Prisma.JsonValue): SearchPortal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const portal = searchPortalSchema.safeParse(entry);
    return portal.success ? [portal.data] : [];
  });
}

/** What a search found, in the order it found them; without those removed from the Archive, unless `withRemoved`. */
export async function postingsOfSearch(searchId: string, { db = prisma, withRemoved = false }: { db?: Db; withRemoved?: boolean } = {}): Promise<FoundPosting[]> {
  const finds = await db.postingFind.findMany({
    where: { searchId, ...(withRemoved ? {} : { posting: { removedAt: null } }) },
    orderBy: [{ foundAt: "asc" }, { id: "asc" }],
    include: { posting: true },
  });
  return finds.map((find) => foundFromPosting(find.posting));
}

/** Postings with where each stands for the user now. */
export async function withStates(postings: readonly FoundPosting[], db: Db = prisma): Promise<ShownPosting[]> {
  const states = await postingStates(postings, db);
  return postings.map((posting) => ({ ...posting, state: states.get(postingKey(posting))! }));
}

/** What every list leaves out: one merged into another shows as that one (E22-6), and one removed from the Archive nowhere (E22-7). */
const SHOWN = { mergedIntoId: null, removedAt: null } satisfies Prisma.PostingWhereInput;

function whereOf(filters: LibraryFilters, now: Date): Prisma.PostingWhereInput {
  const days = POSTED_WITHIN.find((option) => option.value === filters.age)?.days;
  const show: Prisma.PostingWhereInput =
    filters.show === "saved"
      ? { savedAt: { not: null } }
      : filters.show === "dismissed"
        ? { dismissedAt: { not: null } }
        : filters.show === "new"
          ? { dismissedAt: null, seenAt: null }
          : { dismissedAt: null };
  return {
    ...SHOWN,
    // The Archive holds only untouched postings, so Show doesn't apply there (E22-7).
    ...(filters.tab === "archive" ? { archivedAt: { not: null } } : { archivedAt: null, ...show }),
    ...(filters.portal ? { OR: [{ source: filters.portal }, { merged: { some: { source: filters.portal } } }] } : {}),
    ...(filters.found === FOUND_BY_AGENT
      ? { finds: { some: { search: { agentSearchName: { not: null } } } } }
      : filters.found
        ? { finds: { some: { searchId: { in: foundSearchIds(filters.found) ?? [] } } } }
        : {}),
    ...(days ? { postedAt: { gte: new Date(now.getTime() - days * 86_400_000) } } : {}),
  };
}

/**
 * The library through its filters: `LIBRARY_PAGE` postings from `offset`,
 * how many match, and whether there are more. Newest found first; one
 * search's postings in the order it found them; Saved and Dismissed by when.
 * Score and "applied for" (which also counts an application made from the
 * same link) are known only with each posting's state, so they're filtered
 * after reading.
 */
export async function listLibrary(
  filters: LibraryFilters,
  { now = new Date(), offset = 0, db = prisma }: { now?: Date; offset?: number; db?: Db } = {},
): Promise<{ postings: ShownPosting[]; total: number; more: boolean }> {
  const shown = await readLibrary(filters, now, db);
  return { postings: shown.slice(offset, offset + LIBRARY_PAGE), total: shown.length, more: offset + LIBRARY_PAGE < shown.length };
}

/** Every posting the filters show, in order, with its state. */
async function readLibrary(filters: LibraryFilters, now: Date, db: Db): Promise<ShownPosting[]> {
  const byWhen = filters.tab === "positions" && (filters.show === "saved" || filters.show === "dismissed");
  const orderBy: Prisma.PostingOrderByWithRelationInput[] = !byWhen
    ? [{ lastFoundAt: "desc" }, { postedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }]
    : filters.show === "saved"
      ? [{ savedAt: "desc" }]
      : [{ dismissedAt: "desc" }];
  let rows: Posting[] = await db.posting.findMany({ where: whereOf(filters, now), orderBy });
  const several = (foundSearchIds(filters.found)?.length ?? 0) > 1;
  if (filters.found && filters.found !== FOUND_BY_AGENT && !several && !byWhen) {
    const finds = await db.postingFind.findMany({ where: { searchId: filters.found }, orderBy: [{ foundAt: "asc" }, { id: "asc" }], select: { postingId: true } });
    const order = new Map(finds.map((find, index) => [find.postingId, index]));
    rows = rows.toSorted((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  let shown = await withStates(rows.map(foundFromPosting), db);
  if (filters.tab === "positions" && filters.show === "applied") shown = shown.filter((posting) => posting.state.applicationId !== null);
  // Coverage (E32-2): "Fits Backend" goes by that profile's score, else each posting's best.
  const coverageFor = (posting: ShownPosting) => coverageOf(filters.fits ? posting.state.scores.find((fit) => fit.profileId === filters.fits) : posting.state.score);
  if (filters.covers !== "any") shown = shown.filter((posting) => passes(coverageFor(posting), filters.covers));
  // Best fit (E32-2): the order read so far breaks ties, so the newest found (or saved, or a search's own order) comes first.
  if (filters.sort === "fit") {
    shown = shown
      .map((posting, index) => ({ posting, coverage: coverageFor(posting), at: -index }))
      .sort(byBestFit)
      .map(({ posting }) => posting);
  }
  return shown;
}

/** The rows of every posting the filters show: for doing something to all of them. */
export async function libraryIds(filters: LibraryFilters, { now = new Date(), db = prisma }: { now?: Date; db?: Db } = {}): Promise<string[]> {
  return (await readLibrary(filters, now, db)).flatMap((posting) => (posting.state.postingId ? [posting.state.postingId] : []));
}

/** How many postings each Show holds, and the Archive, for the page's counts. */
export async function countLibrary(db: Db = prisma): Promise<{ open: number; new: number; saved: number; applied: number; dismissed: number; archived: number }> {
  const inPositions = { ...SHOWN, archivedAt: null };
  const [open, fresh, saved, dismissed, archived, applied] = await Promise.all([
    db.posting.count({ where: { ...inPositions, dismissedAt: null } }),
    db.posting.count({ where: { ...inPositions, dismissedAt: null, seenAt: null } }),
    db.posting.count({ where: { ...inPositions, savedAt: { not: null } } }),
    db.posting.count({ where: { ...inPositions, dismissedAt: { not: null } } }),
    db.posting.count({ where: { ...SHOWN, archivedAt: { not: null } } }),
    // "Applied for" (E32-3) as the tab lists it: an application made from it, or from the same link.
    readLibrary({ ...DEFAULT_FILTERS, show: "applied", sort: "new" }, new Date(), db).then((shown) => shown.length),
  ]);
  return { open, new: fresh, saved, applied, dismissed, archived };
}

/** Opened, so no longer new. */
export async function markSeen(postingIds: readonly string[], now = new Date()): Promise<void> {
  if (postingIds.length === 0) return;
  await prisma.posting.updateMany({ where: { id: { in: [...postingIds] }, seenAt: null }, data: { seenAt: now } });
}

/** "Mark all as seen": every new posting the filters show. */
export async function markAllSeen(filters: LibraryFilters, now = new Date()): Promise<number> {
  const ids = await libraryIds(filters, { now });
  let count = 0;
  for (let start = 0; start < ids.length; start += 500) {
    count += (await prisma.posting.updateMany({ where: { id: { in: ids.slice(start, start + 500) }, seenAt: null }, data: { seenAt: now } })).count;
  }
  return count;
}

/**
 * Moves what searches from before E22-5 kept as JSON into the library,
 * once: each posting in it (seen, since it was shown then), that the search
 * found it, and its source and next page as the search's one portal. Safe to
 * run again; at start, and after an import of an older file.
 */
export async function movePastSearches(db: Db = prisma): Promise<number> {
  const searches = await db.postingSearch.findMany({ select: { id: true, source: true, postings: true, portals: true, found: true, next: true, createdAt: true } });
  let moved = 0;
  for (const search of searches) {
    const kept = Array.isArray(search.postings) ? search.postings : [];
    const needsPortals = portalsOf(search.portals).length === 0 && search.source !== null;
    if (kept.length === 0 && !needsPortals) continue;
    const postings = kept.flatMap((item) => {
      const posting = foundPostingSchema.safeParse(item);
      return posting.success ? [posting.data] : [];
    });
    await keepFound(search.id, search.source ?? "", postings, { now: search.createdAt, seenAt: search.createdAt, db });
    const portals: SearchPortal[] = needsPortals ? [{ id: search.source!, status: "done", found: search.found, next: search.next, message: null }] : portalsOf(search.portals);
    await db.postingSearch.update({ where: { id: search.id }, data: { postings: [], portals, next: null } });
    moved++;
  }
  return moved;
}

/** A posting New application offers to start from (E31-2): saved, or found by the agent lately. */
export type StartingPoint = {
  id: string;
  title: string;
  company: string;
  place: string;
  salary: string;
  /** Its best score's requirements, covered and in all; 0 of 0 before it's scored. */
  hit: number;
  total: number;
  from: "saved" | "agent";
  /** When it was saved, or when the agent found it. */
  at: Date;
};

/** How far back the agent's finds count as "lately". */
const AGENT_FINDS_DAYS = 7;

/**
 * "Or start from one you saved" (E31-2): saved postings and what the job
 * agent found in the last week, not applied for, dismissed or archived,
 * newest first.
 */
export async function startingPoints({ limit = 5, now = new Date(), db = prisma }: { limit?: number; now?: Date; db?: Db } = {}): Promise<StartingPoint[]> {
  const open = { ...SHOWN, archivedAt: null, dismissedAt: null, applicationId: null } satisfies Prisma.PostingWhereInput;
  const [saved, found] = await Promise.all([
    db.posting.findMany({ where: { ...open, savedAt: { not: null } }, orderBy: [{ savedAt: "desc" }, { id: "asc" }], take: limit }),
    db.posting.findMany({
      where: {
        ...open,
        savedAt: null,
        lastFoundAt: { gte: new Date(now.getTime() - AGENT_FINDS_DAYS * 86_400_000) },
        finds: { some: { search: { agentSearchName: { not: null } } } },
      },
      orderBy: [{ lastFoundAt: "desc" }, { id: "asc" }],
      take: limit,
    }),
  ]);
  const rows = [...saved.map((row) => ({ row, from: "saved" as const, at: row.savedAt! })), ...found.map((row) => ({ row, from: "agent" as const, at: row.lastFoundAt }))]
    .toSorted((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
  const shown = await withStates(rows.map(({ row }) => foundFromPosting(row)), db);
  return rows.map(({ row, from, at }, index) => {
    const requirements = shown[index].state.score?.breakdown?.requirements ?? [];
    return {
      id: row.id,
      title: row.title,
      company: row.company,
      place: row.place,
      salary: row.salary,
      hit: requirements.filter((requirement) => requirement.covered).length,
      total: requirements.length,
      from,
      at,
    };
  });
}
