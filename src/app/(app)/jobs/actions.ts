"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { moveBack, removeArchived } from "@/lib/archive";
import { isAiUsable } from "@/lib/ai/config";
import { handOffFoundPosting, handsOffToClaude } from "@/lib/connector/handoff";
import { loadJobSearchConfig, portalSetup, savePortals } from "@/lib/job-search/config";
import { fullText } from "@/lib/job-search/find";
import { foundPostingSchema, LIBRARY_SHOWS, LIBRARY_SORTS, POSTED_WITHIN, searchQuerySchema, sourceIdSchema } from "@/lib/job-search/search";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { scoreJobKey, scorePostingJob, scoreProfilesSchema } from "@/lib/jobs/score-posting";
import { scoreLevelsProblem, type LevelsProblem } from "@/lib/profiles";
import { libraryIds, listLibrary, markAllSeen, markSeen, splitPosting } from "@/lib/library";
import { COVERS } from "@/lib/posting-coverage";
import { removeSearch, retryPortal, runSearch, showMoreFor } from "@/lib/posting-searches";
import { dismissPosting, savePosting, storePosting, unmarkPosting } from "@/lib/postings";
import { scoringProblem } from "@/lib/scoring";
import { loadScoringConfig } from "@/lib/scoring/config";

// Find jobs (E14-6). Each search is kept with what it found (E14-10).
// Postings come back from the screen as the search gave them, checked
// against the posting shape.

const postingRef = z.object({ source: sourceIdSchema, externalId: z.string().min(1).max(500) });
const searchId = z.string().min(1).max(100);

/** "I understand" under the Bundesagentur für Arbeit's note (#223), for a BA choice made before it, or by DOSSIER_JOBS_SOURCE. */
export const acceptArbeitsagenturNote = action(z.object({}), async () => {
  if (!portalSetup(await loadJobSearchConfig(), "ARBEITSAGENTUR")?.offered) throw new ActionError("The Bundesagentur für Arbeit isn't offered on this server.");
  const acceptedAt = new Date().toISOString();
  await savePortals(({ portals, keys }) => {
    const current = portals.ARBEITSAGENTUR ?? { on: false, fields: {}, acceptedAt: null };
    return { portals: { ...portals, ARBEITSAGENTUR: { ...current, acceptedAt } }, keys };
  });
  return null;
});

/** "Search": asks the chosen source and keeps the search with what it found; gives its id, or what went wrong. */
export const runJobSearch = action(z.object({ query: searchQuerySchema }), ({ query }) => runSearch(query));

/** "Show more": the next page, added to the kept search. */
/** The library's filters as the screen sends them back (E22-5). */
const libraryFilters = z.object({
  tab: z.enum(["positions", "archive"]),
  show: z.enum(LIBRARY_SHOWS.map((option) => option.value) as [string, ...string[]]).transform((value) => value as (typeof LIBRARY_SHOWS)[number]["value"]),
  found: z.string().min(1).max(300).nullable(),
  portal: sourceIdSchema.nullable(),
  age: z.enum(POSTED_WITHIN.map((option) => option.value) as [string, ...string[]]).transform((value) => value as (typeof POSTED_WITHIN)[number]["value"]),
  covers: z.enum(COVERS).default("any"),
  fits: z.string().min(1).max(100).nullable().default(null),
  sort: z.enum(LIBRARY_SORTS).default("fit"),
});

/** "Show more" in the library: its next page through the same filters. */
export const loadLibraryPage = action(z.object({ filters: libraryFilters, offset: z.number().int().min(0).max(100_000) }), async ({ filters, offset }) => {
  const { postings, more } = await listLibrary(filters, { offset });
  return { postings, more };
});

/** Opened: no longer new. */
export const markPostingsSeen = action(z.object({ postingIds: z.array(z.string().min(1).max(100)).max(200) }), async ({ postingIds }) => {
  await markSeen(postingIds);
  return null;
});

/** "Mark all as seen", for what the filters show. */
export const markAllPostingsSeen = action(z.object({ filters: libraryFilters }), async ({ filters }, { toast }) => {
  const count = await markAllSeen(filters);
  toast(count === 1 ? "1 posting marked as seen." : `${count} postings marked as seen.`);
  return { count };
});

const postingIds = z.array(z.string().min(1).max(100)).min(1).max(500);
const postingsCount = (count: number) => (count === 1 ? "1 posting" : `${count} postings`);

/** "Move back" in the Archive (E22-7), for one posting or those selected. */
export const moveBackPostings = action(z.object({ postingIds }), async ({ postingIds }, { toast }) => {
  const count = await moveBack(postingIds);
  toast(`${postingsCount(count)} moved back to Positions.`);
  return { count };
});

/** "Remove" in the Archive (E22-7), for one posting or those selected: no search brings them back. */
export const removeArchivedPostings = action(z.object({ postingIds }), async ({ postingIds }, { toast }) => {
  const count = await removeArchived(postingIds);
  toast(`${postingsCount(count)} removed. No search will bring ${count === 1 ? "it" : "them"} back.`);
  return { count };
});

/** "Remove all" in the Archive (E22-7): every posting its filters show, once the user confirmed. */
export const removeAllArchived = action(z.object({ filters: libraryFilters }), async ({ filters }, { toast }) => {
  if (filters.tab !== "archive") throw new ActionError("Only the Archive can be emptied.");
  const count = await removeArchived(await libraryIds(filters));
  toast(`${postingsCount(count)} removed. No search will bring them back.`);
  return { count };
});

/** "Not the same job" (E22-6): the postings merged into this one show on their own again. */
export const splitSameJob = action(z.object({ postingId: z.string().min(1).max(100) }), async ({ postingId }, { toast }) => {
  const count = await splitPosting(postingId);
  if (count === 0) throw new ActionError("That posting isn't shown as the same job as another.");
  toast(count === 1 ? "Shown apart. The other posting is in the list on its own." : `Shown apart. The ${count} other postings are in the list on their own.`);
  return { count };
});

/** "Try again" on one portal that failed in a search (E22-4). */
export const retryPortalSearch = action(z.object({ searchId, portal: sourceIdSchema }), async ({ searchId, portal }) => {
  if (!(await retryPortal(searchId, portal))) throw new ActionError("That portal isn't waiting for another try.");
  return null;
});

export const showMorePostings = action(z.object({ searchId }), ({ searchId }) => showMoreFor(searchId));

/** Removes a kept search and what it found; saved postings stay. */
export const removeJobSearch = action(z.object({ id: searchId }), async ({ id }, { toast }) => {
  await removeSearch(id);
  toast("Search removed. Saved postings from it stay in Saved.");
  return null;
});

/** The whole text of a posting the search only gave the start of; null when it can't be had. */
export const loadFullText = action(z.object({ posting: foundPostingSchema }), async ({ posting }) => ({ text: await fullText(posting) }));

export const savePostingForLater = action(z.object({ posting: foundPostingSchema }), async ({ posting }, { toast }) => {
  const saved = await savePosting(posting);
  toast("Saved for later.");
  return { postingId: saved.id };
});

export const unsavePosting = action(postingRef, async (ref, { toast }) => {
  await unmarkPosting(ref, "saved");
  toast("Removed from Saved.");
  return null;
});

/** Dismiss: out of this and later searches. Says whether it was saved, so Undo can put it back. */
export const dismissFoundPosting = action(z.object({ posting: foundPostingSchema }), ({ posting }) => dismissPosting(posting));

/**
 * "Start application" (E14-8): keeps the posting with its whole text when it
 * can be had, for New application to open from its id.
 */
export const startApplicationFrom = action(z.object({ posting: foundPostingSchema }), async ({ posting }) => {
  const text = await fullText(posting);
  const stored = await storePosting(text ? { ...posting, description: text, complete: true } : posting);
  return { postingId: stored.id };
});

/** Brings a dismissed posting back, into Saved again when it was there (Undo). */
export const restorePosting = action(postingRef.extend({ saved: z.boolean() }), async ({ saved, ...ref }) => {
  await unmarkPosting(ref, "dismissed", { saved });
  return null;
});

/**
 * "Score" (#208, E25-5): how well a posting fits one profile, or all of
 * them, in the background; a scoring under way is followed, not started
 * again. With the Claude connector on and no AI model of Dossier's own, a
 * Claude chat scores it instead (#221), unless Settings → Scoring chose another scoring model.
 */
export const startScoringPosting = action(
  z.object({ posting: foundPostingSchema, profiles: scoreProfilesSchema }),
  async ({ posting, profiles }): Promise<{ jobId: string } | { handoff: string } | { setLevels: LevelsProblem }> => {
    // Scoring waits until the profile's levels are chosen (E24-3): the browser says so, with a link there. With all of them, it waits for none.
    const waiting = await scoreLevelsProblem(profiles);
    if (waiting) return { setLevels: waiting };
    const scoring = await loadScoringConfig();
    if (scoring.scorer === "AI" && (await handsOffToClaude(await isAiUsable()))) return { handoff: await handOffFoundPosting(posting, "score") };
    const problem = await scoringProblem(scoring);
    if (problem) throw new ActionError(problem);
    const key = scoreJobKey(posting);
    const [unfinished] = await findUnfinishedJobs(key);
    return { jobId: unfinished?.id ?? (await startJob(scorePostingJob, { posting, profiles }, { key })) };
  },
);
