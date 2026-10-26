import type { Metadata } from "next";

import { isAiUsable } from "@/lib/ai/config";
import { handsOffToClaude } from "@/lib/connector/handoff";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { COUNTRIES } from "@/lib/job-search/countries";
import { defaultSearch, latestRole, queryFromParams, viewFromParams } from "@/lib/job-search/search";
import { countSearches, listSearches, loadSearch } from "@/lib/posting-searches";
import { countPostings, listPostings } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { userTimeZone } from "@/lib/time-zone";

import { JobsScreen } from "./jobs-screen";

export const metadata: Metadata = { title: "Find jobs" };

/**
 * Find jobs (E14-6). Every search is kept with what it found (E14-10):
 * ?search=<id> opens one, and without it the latest one shows, so going back
 * costs no searches. ?view=history lists past searches; ?view=saved and
 * ?view=dismissed the postings kept from them (E14-7). A search written in
 * the URL (?q=…) only fills in the form.
 */
export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const params = await searchParams;
  const view = viewFromParams(params);
  const typed = queryFromParams(params);
  const searchId = typeof params.search === "string" ? params.search : undefined;
  const [config, timeZone, postingCounts, searches, scoreInClaude] = await Promise.all([
    loadJobSearchConfig(),
    userTimeZone(),
    countPostings(),
    countSearches(),
    isAiUsable().then(handsOffToClaude),
  ]);
  const now = new Date();

  const search = view === "search" && !typed ? await loadSearch(searchId, { timeZone, now }) : null;
  const [kept, history] = await Promise.all([
    view === "saved" || view === "dismissed" ? listPostings(view) : undefined,
    view === "history" ? listSearches({ timeZone, now }) : undefined,
  ]);

  return (
    <JobsScreen
      source={config.source}
      arbeitsagenturNote={config.source === "ARBEITSAGENTUR" && !config.arbeitsagentur.acceptedAt}
      scoreInClaude={scoreInClaude}
      // Named here: the browser's ICU can name a few countries differently from the server's.
      countries={COUNTRIES}
      view={view}
      query={typed ?? search?.query ?? (await latestQuery()) ?? (await profileSearch())}
      search={search}
      missingSearch={Boolean(searchId) && !search}
      kept={kept}
      history={history}
      counts={{ ...postingCounts, searches }}
      today={now.toISOString()}
    />
  );
}

/** What was searched last, for the form when no search is open. */
async function latestQuery() {
  return (await loadSearch())?.query ?? null;
}

/** The first search: the current or latest role, in the profile's city and country. */
async function profileSearch() {
  const [fields, experience] = await Promise.all([
    prisma.profileField.findMany({ where: { key: { in: ["city", "country"] } } }),
    prisma.experience.findMany({ select: { role: true, current: true, startYear: true, startMonth: true, endYear: true, endMonth: true } }),
  ]);
  const field = (key: string) => fields.find((entry) => entry.key === key)?.value ?? "";
  return defaultSearch({ role: latestRole(experience), city: field("city"), country: field("country") });
}
