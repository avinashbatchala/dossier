import "server-only";

import { z } from "zod";

import { defineJob, findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { saveSettings } from "@/lib/settings-data";

import { SourceError } from "./http";
import { placeOf } from "./place";
import { fetchHnStartups } from "./sources/hn";
import { fetchYcStartups } from "./sources/yc";
import { lookUpStartup, rescoreStartups, sweepStartups, upsertStartups } from "./store";
import { STARTUP_SOURCE_INFO, startupsRefreshSchema, type FoundStartup, type StartupSource, type StartupsRefresh } from "./types";

// "Refresh" on the Startups screen (#222), and once a day while the screen
// is in use: asks both sources what's new, keeps it, scores it, and looks
// for role addresses on the best new matches' own sites. One source failing
// doesn't stop the other; what happened is kept for the screen.

export const STARTUPS_JOB_KEY = "startups-refresh";
/** Sites read for addresses per refresh: the best matches not checked yet. */
const SITE_LOOKUPS = 12;
/** Different sites read at once; each site's own pages are read one at a time. */
const SITE_CONCURRENCY = 4;

/** Runs both sources, keeps what they found, and looks up addresses for the best new startups. */
export async function refreshStartups(
  step: (name: string) => Promise<void> = async () => {},
  signal: AbortSignal = new AbortController().signal,
  now = new Date(),
): Promise<StartupsRefresh> {
  const place = placeOf((await loadProfile()).basics);
  const sources: { source: StartupSource; fetch: () => Promise<FoundStartup[]> }[] = [
    { source: "YC", fetch: () => fetchYcStartups(signal) },
    { source: "HN", fetch: () => fetchHnStartups(place, signal) },
  ];

  await step("Asking Y Combinator and Hacker News");
  const results = await Promise.allSettled(sources.map((entry) => entry.fetch()));
  signal.throwIfAborted();
  const outcomes = results.map((result, index) => {
    const { source } = sources[index];
    if (result.status === "fulfilled") return { source, found: result.value.length, error: null };
    const reason = result.reason instanceof SourceError ? result.reason.message : "failed";
    if (!(result.reason instanceof SourceError)) logServerError(`startups: ${source}`, result.reason);
    return { source, found: 0, error: `${STARTUP_SOURCE_INFO[source].name} ${reason}` };
  });
  const found = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  await step(`Scoring ${found.length} ${found.length === 1 ? "startup" : "startups"} against your profile`);
  const added = await upsertStartups(found, now);
  // Ones this refresh didn't find again are scored against today's profile too.
  await rescoreStartups(now);
  await sweepStartups(now);

  await step("Looking for application addresses on their own sites");
  const toCheck = await prisma.startup.findMany({
    where: { status: { in: ["NEW", "SAVED"] }, emailsCheckedAt: null, website: { not: "" }, noApplicationsFrom: "" },
    orderBy: { score: "desc" },
    take: SITE_LOOKUPS,
    select: { id: true, emails: true },
  });
  let emailsFound = 0;
  for (let index = 0; index < toCheck.length; index += SITE_CONCURRENCY) {
    signal.throwIfAborted();
    const batch = toCheck.slice(index, index + SITE_CONCURRENCY);
    const checked = await Promise.allSettled(batch.map((startup) => lookUpStartup(startup.id, { now })));
    checked.forEach((result, position) => {
      const before = Array.isArray(batch[position].emails) ? (batch[position].emails as unknown[]).length : 0;
      if (result.status === "fulfilled" && result.value && result.value.emails.length > before) emailsFound += 1;
      if (result.status === "rejected") logServerError("startups: address lookup", result.reason);
    });
  }

  const result: StartupsRefresh = { at: now.toISOString(), added, sources: outcomes, emailsFound };
  await saveSettings({ startupsLastRefresh: result });
  return result;
}

export const refreshStartupsJob = defineJob({
  type: "startups-refresh",
  input: z.object({}),
  result: startupsRefreshSchema,
  run: (_input, { step, signal }) => refreshStartups(step, signal),
});

/** Starts a refresh unless one is under way; returns its job. */
export async function startStartupsRefresh(): Promise<string> {
  const [running] = await findUnfinishedJobs(STARTUPS_JOB_KEY);
  return running?.id ?? startJob(refreshStartupsJob, {}, { key: STARTUPS_JOB_KEY });
}
