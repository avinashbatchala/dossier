import "server-only";

import { z } from "zod";

import type { JobSourceAdapter, JSearchHost, RequestContext, SourceCredentials } from "./adapter";
import { countryName } from "./countries";
import { jobSearchError } from "./errors";
import { requestJson } from "./http";
import { safeLink, type FoundPosting, type PostedWithin, type SearchPage, type SearchQuery } from "./search";

// JSearch (E14-1): Google for Jobs through OpenWeb Ninja, or the same API on
// RapidAPI. One search page is one request from the plan (200 a month free).
// Both hosts answer search-v2, which nests the jobs under `data` and pages
// with a cursor. RapidAPI's old /search, which paged by number, now answers
// 404.

const SEARCH_PATH = "/search-v2";

const HOSTS: Record<JSearchHost, { base: string; headers: (key: string) => Record<string, string> }> = {
  openwebninja: {
    base: "https://api.openwebninja.com/jsearch",
    headers: (key) => ({ "x-api-key": key }),
  },
  rapidapi: {
    base: "https://jsearch.p.rapidapi.com",
    headers: (key) => ({ "x-rapidapi-key": key, "x-rapidapi-host": "jsearch.p.rapidapi.com" }),
  },
};

const DATE_POSTED: Record<PostedWithin, string> = { any: "all", day: "today", "3days": "3days", week: "week", month: "month" };

// Every field may be missing or null; one odd field doesn't drop the posting.
const maybeText = z.string().nullish().catch(null);
const maybeNumber = z.number().nullish().catch(null);
const maybeFlag = z.boolean().nullish().catch(null);

const jobSchema = z.object({
  job_id: z.string().min(1),
  job_title: maybeText,
  employer_name: maybeText,
  job_publisher: maybeText,
  job_apply_link: maybeText,
  apply_options: z
    .array(z.object({ publisher: maybeText, apply_link: maybeText, is_direct: maybeFlag }))
    .nullish()
    .catch(null),
  job_google_link: maybeText,
  job_description: maybeText,
  job_is_remote: maybeFlag,
  job_posted_at_datetime_utc: maybeText,
  job_posted_at_timestamp: maybeNumber,
  job_location: maybeText,
  job_city: maybeText,
  job_state: maybeText,
  job_country: maybeText,
  job_salary: maybeText,
  job_salary_string: maybeText,
  job_min_salary: maybeNumber,
  job_max_salary: maybeNumber,
  job_salary_currency: maybeText,
  job_salary_period: maybeText,
});
type Job = z.output<typeof jobSchema>;

const responseSchema = z.object({
  data: z.object({ jobs: z.array(z.unknown()), cursor: z.string().nullish() }),
});

const PERIODS: Record<string, string> = { YEAR: "a year", MONTH: "a month", WEEK: "a week", DAY: "a day", HOUR: "an hour" };

/** "EUR 60,000–75,000 a year", from the salary fields; empty when there's none. */
function salaryOf(job: Job): string {
  const written = job.job_salary?.trim() || job.job_salary_string?.trim();
  if (written) return written;
  const { job_min_salary: min, job_max_salary: max } = job;
  if (min == null && max == null) return "";
  const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const range = min != null && max != null && min !== max ? `${amount(min)}–${amount(max)}` : amount((min ?? max)!);
  return [job.job_salary_currency, range, PERIODS[job.job_salary_period?.toUpperCase() ?? ""]].filter(Boolean).join(" ");
}

function postedAtOf(job: Job): string | null {
  const parsed = job.job_posted_at_datetime_utc ? Date.parse(job.job_posted_at_datetime_utc) : NaN;
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return job.job_posted_at_timestamp ? new Date(job.job_posted_at_timestamp * 1000).toISOString() : null;
}

/** The employer's own apply link when there is one, else the publisher's. */
function linkOf(job: Job): string {
  const options = job.apply_options ?? [];
  const direct = options.find((option) => option.is_direct && safeLink(option.apply_link));
  return safeLink(direct?.apply_link) || safeLink(job.job_apply_link) || safeLink(options[0]?.apply_link) || safeLink(job.job_google_link);
}

/**
 * Where the job is. JSearch writes the location in the country's language
 * with the publisher after a bullet ("Hamburg  •  über Stepstone"), and often
 * leaves the city fields empty.
 */
function placeOf(job: Job): string {
  const written = (job.job_location ?? "").split("•")[0].replace(/\s+/g, " ").trim();
  if (written) return written;
  return [job.job_city, job.job_state, job.job_country ? countryName(job.job_country.toLowerCase()) : null].filter(Boolean).join(", ");
}

export function postingFromJob(job: Job): FoundPosting {
  const description = (job.job_description ?? "").trim().slice(0, 100_000);
  return {
    source: "JSEARCH",
    externalId: job.job_id.slice(0, 500),
    title: (job.job_title ?? "").trim().slice(0, 500),
    company: (job.employer_name ?? "").trim().slice(0, 300),
    place: placeOf(job).slice(0, 300),
    remote: job.job_is_remote ?? null,
    salary: salaryOf(job).slice(0, 200),
    postedAt: postedAtOf(job),
    url: linkOf(job).slice(0, 2000),
    via: (job.job_publisher ?? "").trim().slice(0, 100),
    description,
    complete: description.length > 0,
  };
}

/** "designer in Hamburg": JSearch reads the place from the query text, as Google does. */
function queryText({ keywords, place }: SearchQuery): string {
  return place ? `${keywords} in ${place}` : keywords;
}

function searchUrl(query: SearchQuery, host: JSearchHost, next: string | null, baseUrl?: string): URL {
  const url = new URL(`${baseUrl ?? HOSTS[host].base}${SEARCH_PATH}`);
  url.searchParams.set("query", queryText(query));
  // Without a country, JSearch searches the US.
  url.searchParams.set("country", query.country || "us");
  url.searchParams.set("date_posted", DATE_POSTED[query.postedWithin]);
  if (query.place) url.searchParams.set("radius", String(query.radiusKm));
  if (query.remoteOnly) url.searchParams.set("work_from_home", "true");
  // A page number kept in a past search from RapidAPI's old /search starts
  // over; Show more leaves out the postings it already has.
  if (next?.startsWith("cursor:")) url.searchParams.set("cursor", next.slice("cursor:".length));
  return url;
}

async function searchPage(
  query: SearchQuery,
  { key, host }: SourceCredentials["JSEARCH"],
  next: string | null,
  context: RequestContext = {},
): Promise<SearchPage> {
  const url = searchUrl(query, host, next, context.baseUrl);
  const answer = responseSchema.safeParse(await requestJson("JSEARCH", url, { headers: HOSTS[host].headers(key), signal: context.signal }));
  if (!answer.success) throw jobSearchError("changed", "JSEARCH", { detail: `${url.pathname}: unexpected answer` });

  const { jobs, cursor } = answer.data.data;
  const seen = new Set<string>();
  const postings: FoundPosting[] = [];
  for (const item of jobs) {
    const job = jobSchema.safeParse(item);
    if (!job.success || seen.has(job.data.job_id)) continue;
    seen.add(job.data.job_id);
    postings.push(postingFromJob(job.data));
  }

  return { postings, next: cursor ? `cursor:${cursor}` : null };
}

export const jsearch: JobSourceAdapter<"JSEARCH"> = {
  source: "JSEARCH",
  search: searchPage,
  // Search results carry the whole description.
  details: async (posting) => (posting.description ? posting.description : null),
  test: async (credentials, context) => {
    await searchPage({ keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, credentials, null, context);
  },
};
