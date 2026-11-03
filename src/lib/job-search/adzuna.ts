import "server-only";

import { z } from "zod";

import { fetchPosting } from "@/lib/posting-fetch";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { jobSearchError } from "./errors";
import { requestJson } from "./http";
import { POSTED_WITHIN, safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

// Adzuna (E14-2): its own job index in 19 countries, free with an app ID
// and key (about 250 calls a day). It only sends the start of each posting,
// so the rest comes from the posting's page when it's selected. The
// countries it covers are in SOURCE_INFO.

const BASE = "https://api.adzuna.com/v1/api/jobs";
const PAGE_SIZE = 20;

/** Adzuna gives salaries without a currency; it's the country's. */
const CURRENCIES: Record<string, string> = {
  at: "EUR", au: "AUD", be: "EUR", br: "BRL", ca: "CAD", ch: "CHF", de: "EUR", es: "EUR", fr: "EUR", gb: "GBP",
  in: "INR", it: "EUR", mx: "MXN", nl: "EUR", nz: "NZD", pl: "PLN", sg: "SGD", us: "USD", za: "ZAR",
};

const maybeText = z.string().nullish().catch(null);
const maybeNumber = z.coerce.number().nullish().catch(null);

const resultSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: maybeText,
  description: maybeText,
  created: maybeText,
  redirect_url: maybeText,
  company: z.object({ display_name: maybeText }).nullish().catch(null),
  location: z.object({ display_name: maybeText }).nullish().catch(null),
  salary_min: maybeNumber,
  salary_max: maybeNumber,
  salary_is_predicted: z.union([z.string(), z.number(), z.boolean()]).nullish().catch(null),
});
type Result = z.output<typeof resultSchema>;

const responseSchema = z.object({ results: z.array(z.unknown()), count: z.coerce.number().nullish().catch(null) });

function salaryOf(result: Result, country: string): string {
  const { salary_min: min, salary_max: max } = result;
  if (!min && !max) return "";
  const amount = (value: number) => Math.round(value).toLocaleString("en-US");
  const range = min && max && Math.round(min) !== Math.round(max) ? `${amount(min)}–${amount(max)}` : amount((min || max)!);
  const estimated = result.salary_is_predicted === "1" || result.salary_is_predicted === 1 || result.salary_is_predicted === true;
  return [CURRENCIES[country], range, "a year", estimated ? "(estimated)" : ""].filter(Boolean).join(" ");
}

export function postingFromResult(result: Result, country: string): FoundPosting {
  const created = result.created ? Date.parse(result.created) : Number.NaN;
  return {
    source: "ADZUNA",
    externalId: result.id.slice(0, 500),
    title: plainText(result.title).slice(0, 500),
    company: plainText(result.company?.display_name).slice(0, 300),
    place: plainText(result.location?.display_name).slice(0, 300),
    remote: null,
    salary: salaryOf(result, country).slice(0, 200),
    postedAt: Number.isNaN(created) ? null : new Date(created).toISOString(),
    url: safeLink(result.redirect_url).slice(0, 2000),
    via: "",
    description: plainText(result.description).slice(0, 100_000),
    complete: false,
  };
}

function searchUrl(query: SearchQuery, { appId, key }: SourceCredentials["ADZUNA"], page: number, baseUrl?: string): URL {
  const url = new URL(`${baseUrl ?? BASE}/${query.country}/search/${page}`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("app_key", key);
  url.searchParams.set("results_per_page", String(PAGE_SIZE));
  // Adzuna has no remote filter: the word does what it can.
  url.searchParams.set("what", query.remoteOnly ? `${query.keywords} remote` : query.keywords);
  if (query.place) {
    url.searchParams.set("where", query.place);
    url.searchParams.set("distance", String(query.radiusKm));
  }
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  if (days) url.searchParams.set("max_days_old", String(days));
  return url;
}

async function searchPage(query: SearchQuery, credentials: SourceCredentials["ADZUNA"], next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const page = next?.startsWith("page:") ? Math.max(1, Number(next.slice("page:".length)) || 1) : 1;
  const url = searchUrl(query, credentials, page, context.baseUrl);
  const answer = responseSchema.safeParse(await requestJson("ADZUNA", url, { signal: context.signal }));
  if (!answer.success) throw jobSearchError("changed", "ADZUNA", { detail: `${url.pathname}: unexpected answer` });

  const seen = new Set<string>();
  const postings: FoundPosting[] = [];
  for (const item of answer.data.results) {
    const result = resultSchema.safeParse(item);
    if (!result.success || seen.has(result.data.id)) continue;
    seen.add(result.data.id);
    postings.push(postingFromResult(result.data, query.country));
  }
  const total = answer.data.count ?? 0;
  return { postings, next: page * PAGE_SIZE < total && answer.data.results.length > 0 ? `page:${page + 1}` : null };
}

export const adzuna: JobSourceAdapter<"ADZUNA"> = {
  source: "ADZUNA",
  search: searchPage,
  // The rest of the posting is on its page, which the guarded fetcher reads like "Fetch" does (E7-8).
  details: async (posting) => {
    if (!posting.url) return null;
    const page = await fetchPosting(posting.url);
    return page.ok ? page.text : null;
  },
  test: async (credentials, context) => {
    await searchPage({ keywords: "developer", place: "", country: "gb", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, credentials, null, context);
  },
};
