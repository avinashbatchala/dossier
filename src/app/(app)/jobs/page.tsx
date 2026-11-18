import type { Metadata } from "next";

import { listProfiles } from "@/lib/profiles";
import { isAiUsable } from "@/lib/ai/config";
import { handsOffToClaude } from "@/lib/connector/handoff";
import { enabledPortals, loadJobSearchConfig, portalSetup } from "@/lib/job-search/config";
import { COUNTRIES } from "@/lib/job-search/countries";
import { defaultSearch, EMPTY_QUERY, foundSearchIds, latestRole, libraryFromParams, queryFromParams, searchQuerySchema } from "@/lib/job-search/search";
import { countLibrary, listLibrary } from "@/lib/library";
import { listSearches, loadSearch } from "@/lib/posting-searches";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { userTimeZone } from "@/lib/time-zone";

import { JobsScreen } from "./jobs-screen";

export const metadata: Metadata = { title: "Positions" };

/**
 * Positions (E14-6, E22-5): the search form and the positions library,
 * through the filters in the URL (tab, show, found, portal, age, score);
 * ?tab=archive is the Archive (E22-7). A search
 * lands on ?found=<id>, what it found. Links from before still work:
 * ?search=<id> is "found by", ?view=saved and ?view=dismissed those kinds. A
 * search written in the URL (?q=…) only fills in the form.
 */
export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const params = await searchParams;
  const filters = libraryFromParams(params);
  const typed = queryFromParams(params);
  const [config, timeZone, counts, scoreInClaude, settings, profiles] = await Promise.all([
    loadJobSearchConfig(),
    userTimeZone(),
    countLibrary(),
    isAiUsable().then(handsOffToClaude),
    loadSettings(),
    listProfiles(),
  ]);
  const now = new Date();
  // "Found by the agent" is all its searches at once, not one to show (E22-8).
  // An agent run's several searches (E26-4) have no one search to show above the list.
  const ids = foundSearchIds(filters.found);
  const oneSearch = ids?.length === 1 ? ids[0] : null;
  const [library, searches, foundSearch] = await Promise.all([
    listLibrary(filters, { now }),
    listSearches({ timeZone, now }),
    oneSearch ? loadSearch(oneSearch, { timeZone, now }) : null,
  ]);
  const enabled = enabledPortals(config);

  return (
    <JobsScreen
      sources={enabled}
      arbeitsagenturNote={enabled.includes("ARBEITSAGENTUR") && !portalSetup(config, "ARBEITSAGENTUR")?.acceptedAt}
      scoreInClaude={scoreInClaude}
      profiles={profiles}
      // Named here: the browser's ICU can name a few countries differently from the server's.
      countries={COUNTRIES}
      query={typed ?? foundSearch?.query ?? (await latestQuery()) ?? (await profileSearch())}
      // A search in the URL opens the form to run it (E32-3).
      editing={typed !== null}
      filters={filters}
      library={library}
      searches={searches}
      foundSearch={foundSearch}
      missingSearch={Boolean(oneSearch) && !foundSearch}
      counts={counts}
      archiveDays={settings.archiveAfterDays}
      today={now.toISOString()}
    />
  );
}

/** What was searched last, for the form when no search is open. */
async function latestQuery() {
  const latest = await prisma.postingSearch.findFirst({ where: { agentSearchName: null }, orderBy: { createdAt: "desc" }, select: { query: true } });
  return latest ? searchQuerySchema.catch(EMPTY_QUERY).parse(latest.query) : null;
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
