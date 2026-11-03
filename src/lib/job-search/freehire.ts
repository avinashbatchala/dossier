import "server-only";

import { z } from "zod";

import { fetchPosting } from "@/lib/posting-fetch";

import type { JobSourceAdapter, RequestContext } from "./adapter";
import { jobSearchError } from "./errors";
import { requestJson } from "./http";
import { POSTED_WITHIN, safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { FREEHIRE_URL } from "./sources";

// FreeHire: ATS-direct catalogue over a public HTTP API (no key). Search
// uses /agent/jobs/search so each hit already carries the full plain-text
// description. Radius isn't supported; place goes into `q` like JSearch,
// which puts postings there first rather than leaving the rest out. Its
// `cities` filter only knows its own spelling of a city, and with
// `countries` it widens to the whole country. Self-host / e2e override the
// origin via RequestContext.baseUrl.

const SEARCH_PATH = "/api/v1/agent/jobs/search";
const PAGE_SIZE = 20;
/** It answers nothing past the first 10,000 results of a search. */
const MAX_RESULTS = 10_000;

const maybeText = z.string().nullish().catch(null);
const maybeNumber = z.number().nullish().catch(null);

const enrichmentSchema = z
  .object({
    salary_min: maybeNumber,
    salary_max: maybeNumber,
    salary_currency: maybeText,
    salary_period: maybeText,
  })
  .nullish()
  .catch(null);

const jobSchema = z.object({
  public_slug: z.string().min(1),
  title: maybeText,
  company: maybeText,
  location: maybeText,
  url: maybeText,
  source: maybeText,
  work_mode: maybeText,
  posted_at: maybeText,
  description: maybeText,
  enrichment: enrichmentSchema,
});
type Job = z.output<typeof jobSchema>;

const responseSchema = z.object({
  data: z.array(z.unknown()),
  meta: z
    .object({
      total: z.number().nullish().catch(null),
      limit: z.number().nullish().catch(null),
      offset: z.number().nullish().catch(null),
    })
    .nullish()
    .catch(null),
});

const PERIODS: Record<string, string> = { year: "a year", month: "a month", day: "a day", hour: "an hour" };

function salaryOf(job: Job): string {
  const enrichment = job.enrichment;
  if (!enrichment) return "";
  const { salary_min: min, salary_max: max } = enrichment;
  if (min == null && max == null) return "";
  const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const range = min != null && max != null && min !== max ? `${amount(min)}–${amount(max)}` : amount((min ?? max)!);
  return [enrichment.salary_currency, range, PERIODS[enrichment.salary_period?.toLowerCase() ?? ""]].filter(Boolean).join(" ");
}

function remoteOf(workMode: string | null | undefined): boolean | null {
  if (workMode === "remote") return true;
  if (workMode === "onsite") return false;
  return null;
}

function postedAtOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function postingFromJob(job: Job): FoundPosting {
  const description = (job.description ?? "").trim().slice(0, 100_000);
  return {
    source: "FREEHIRE",
    externalId: job.public_slug.slice(0, 500),
    title: (job.title ?? "").trim().slice(0, 500),
    company: (job.company ?? "").trim().slice(0, 300),
    place: (job.location ?? "").trim().slice(0, 300),
    remote: remoteOf(job.work_mode),
    salary: salaryOf(job).slice(0, 200),
    postedAt: postedAtOf(job.posted_at),
    url: safeLink(job.url).slice(0, 2000),
    via: (job.source ?? "").trim().slice(0, 100),
    description,
    complete: description.length > 0,
  };
}

/** "designer in Hamburg": FreeHire has no radius; place rides in the query text. */
function queryText({ keywords, place }: SearchQuery): string {
  return place ? `${keywords} in ${place}` : keywords;
}

function searchUrl(query: SearchQuery, offset: number, baseUrl?: string): URL {
  const url = new URL(`${(baseUrl ?? FREEHIRE_URL).replace(/\/+$/, "")}${SEARCH_PATH}`);
  url.searchParams.set("q", queryText(query));
  url.searchParams.set("description_format", "text");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  if (query.country) url.searchParams.set("countries", query.country.toUpperCase());
  if (query.remoteOnly) url.searchParams.set("work_mode", "remote");
  // The date its source states; open_within_days would be when FreeHire first saw it.
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  if (days) url.searchParams.set("posted_within_days", String(days));
  return url;
}

function pageOffset(next: string | null): number {
  if (!next?.startsWith("offset:")) return 0;
  return Math.max(0, Number(next.slice("offset:".length)) || 0);
}

async function searchPage(query: SearchQuery, _credentials: Record<string, never>, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const offset = pageOffset(next);
  const url = searchUrl(query, offset, context.baseUrl);
  const answer = responseSchema.safeParse(await requestJson("FREEHIRE", url, { signal: context.signal }));
  if (!answer.success) throw jobSearchError("changed", "FREEHIRE", { detail: `${url.pathname}: unexpected answer` });

  const seen = new Set<string>();
  const postings: FoundPosting[] = [];
  for (const item of answer.data.data) {
    const job = jobSchema.safeParse(item);
    if (!job.success || seen.has(job.data.public_slug)) continue;
    seen.add(job.data.public_slug);
    postings.push(postingFromJob(job.data));
  }

  const total = answer.data.meta?.total ?? null;
  const nextOffset = offset + PAGE_SIZE;
  const more = nextOffset + PAGE_SIZE <= MAX_RESULTS && (total != null ? nextOffset < total : answer.data.data.length >= PAGE_SIZE);
  return { postings, next: more ? `offset:${nextOffset}` : null };
}

export const freehire: JobSourceAdapter<"FREEHIRE"> = {
  source: "FREEHIRE",
  search: searchPage,
  // Only asked when a posting came without its text: then its page, read like "Fetch" does (E7-8).
  details: async (posting) => {
    if (!posting.url) return null;
    const page = await fetchPosting(posting.url);
    return page.ok ? page.text : null;
  },
  test: async (_credentials, context) => {
    await searchPage({ keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, {}, null, context);
  },
};
