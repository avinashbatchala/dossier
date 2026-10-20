"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { isAiConfigured } from "@/lib/ai/config";
import { fullText } from "@/lib/job-search/find";
import { foundPostingSchema, JOB_SOURCES, searchQuerySchema } from "@/lib/job-search/search";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { scoreJobKey, scorePostingJob } from "@/lib/jobs/score-posting";
import { removeSearch, runSearch, showMoreFor } from "@/lib/posting-searches";
import { dismissPosting, savePosting, storePosting, unmarkPosting } from "@/lib/postings";

// Find jobs (E14-6). Each search is kept with what it found (E14-10).
// Postings come back from the screen as the search gave them, checked
// against the posting shape.

const postingRef = z.object({ source: z.enum(JOB_SOURCES), externalId: z.string().min(1).max(500) });
const searchId = z.string().min(1).max(100);

/** "Search": asks the chosen source and keeps the search with what it found; gives its id, or what went wrong. */
export const runJobSearch = action(z.object({ query: searchQuerySchema }), ({ query }) => runSearch(query));

/** "Show more": the next page, added to the kept search. */
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

/** "Score" (#208): how well a posting fits the profile, in the background; a scoring under way is followed, not started again. */
export const startScoringPosting = action(z.object({ posting: foundPostingSchema }), async ({ posting }) => {
  if (!(await isAiConfigured())) throw new ActionError("Choose an AI provider in Settings → AI provider first.");
  const key = scoreJobKey(posting);
  const [unfinished] = await findUnfinishedJobs(key);
  return { jobId: unfinished?.id ?? (await startJob(scorePostingJob, { posting }, { key })) };
});
