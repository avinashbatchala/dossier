import "server-only";

import { z } from "zod";

import { fetchPosting } from "@/lib/posting-fetch";

import type { JobSourceAdapter, RequestContext } from "./adapter";
import { JobSearchError, jobSearchError } from "./errors";
import { requestJson } from "./http";
import { POSTED_WITHIN, safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { arbeitsagenturPage } from "./sources";
import { fromMarkdown } from "./text";

// The Bundesagentur für Arbeit (E14-3): Germany's federal job board, free
// and without a key. It isn't an official API: this is the public client ID
// the agency's own site uses, and its paths and fields have changed before
// (community docs: github.com/bundesAPI/jobsuche-api). Checked against the
// live service on 3 October 2026: searches answer on v6, details on v4; the
// other versions answer 403.

const BASE = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service";
const PATHS = { search: "/pc/v6/jobs", details: "/pc/v4/jobdetails/" } as const;
const HEADERS = { "X-API-Key": "jobboerse-jobsuche" };
const PAGE_SIZE = 25;

const maybeText = z.string().nullish().catch(null);
const maybeNumber = z.coerce.number().nullish().catch(null);

const offerSchema = z.object({
  referenznummer: z.string().min(1),
  stellenangebotsTitel: maybeText,
  firma: maybeText,
  stellenlokationen: z
    .array(z.object({ adresse: z.object({ ort: maybeText, plz: maybeText, region: maybeText }).nullish().catch(null) }))
    .nullish()
    .catch(null),
  homeofficemoeglich: z.boolean().nullish().catch(null),
  homeofficeprozent: maybeNumber,
  datumErsteVeroeffentlichung: maybeText,
  gehaltsspanneVon: maybeNumber,
  gehaltsspanneBis: maybeNumber,
  externeURL: maybeText,
});
type Offer = z.output<typeof offerSchema>;

const searchSchema = z.object({ ergebnisliste: z.array(z.unknown()).nullish(), maxErgebnisse: z.coerce.number().nullish().catch(null) });
const detailsSchema = z.object({ stellenangebotsBeschreibung: maybeText });

/** Every failure here is the service's: there's no key of the user's to refuse. */
async function request(url: URL, context: RequestContext): Promise<unknown> {
  try {
    return await requestJson("ARBEITSAGENTUR", url, { headers: HEADERS, signal: context.signal });
  } catch (error) {
    if (error instanceof JobSearchError && error.problem === "key") {
      throw jobSearchError("changed", "ARBEITSAGENTUR", { detail: error.detail?.replace(/^ARBEITSAGENTUR: /, "") });
    }
    throw error;
  }
}

/** "Hamburg", or "Hamburg / Lübeck" for a posting in more than one place. */
function placeOf(offer: Offer): string {
  const places = (offer.stellenlokationen ?? []).map((location) => location.adresse?.ort?.trim()).filter(Boolean);
  return [...new Set(places)].slice(0, 2).join(" / ");
}

function salaryOf(offer: Offer): string {
  const { gehaltsspanneVon: from, gehaltsspanneBis: to } = offer;
  if (!from && !to) return "";
  const amount = (value: number) => Math.round(value).toLocaleString("en-US");
  return `EUR ${from && to && from !== to ? `${amount(from)}–${amount(to)}` : amount((from || to)!)}`;
}

export function postingFromOffer(offer: Offer): FoundPosting {
  const posted = offer.datumErsteVeroeffentlichung ? Date.parse(`${offer.datumErsteVeroeffentlichung.slice(0, 10)}T00:00:00Z`) : Number.NaN;
  return {
    source: "ARBEITSAGENTUR",
    externalId: offer.referenznummer.slice(0, 500),
    title: (offer.stellenangebotsTitel ?? "").trim().slice(0, 500),
    company: (offer.firma ?? "").trim().slice(0, 300),
    place: placeOf(offer).slice(0, 300),
    // Home office "possible" is usually part of the week; only all of it counts as remote.
    remote: offer.homeofficeprozent != null && offer.homeofficeprozent >= 100 ? true : offer.homeofficemoeglich === false ? false : null,
    salary: salaryOf(offer),
    postedAt: Number.isNaN(posted) ? null : new Date(posted).toISOString(),
    url: (safeLink(offer.externeURL) || arbeitsagenturPage({ source: "ARBEITSAGENTUR", externalId: offer.referenznummer })!).slice(0, 2000),
    via: "",
    description: "",
    complete: false,
  };
}

function searchUrl(query: SearchQuery, page: number, baseUrl?: string): URL {
  const url = new URL(`${baseUrl ?? BASE}${PATHS.search}`);
  url.searchParams.set("was", query.keywords);
  // Jobs, as the agency's own search starts with; not training places or internships.
  url.searchParams.set("angebotsart", "1");
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  if (query.place) {
    url.searchParams.set("wo", query.place);
    url.searchParams.set("umkreis", String(query.radiusKm));
  }
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  if (days) url.searchParams.set("veroeffentlichtseit", String(days));
  if (query.remoteOnly) url.searchParams.set("arbeitszeit", "ho");
  return url;
}

async function searchPage(query: SearchQuery, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const page = next?.startsWith("page:") ? Math.max(1, Number(next.slice("page:".length)) || 1) : 1;
  const url = searchUrl(query, page, context.baseUrl);
  const answer = searchSchema.safeParse(await request(url, context));
  if (!answer.success) throw jobSearchError("changed", "ARBEITSAGENTUR", { detail: `${url.pathname}: unexpected answer` });

  const list = answer.data.ergebnisliste ?? [];
  const seen = new Set<string>();
  const postings: FoundPosting[] = [];
  for (const item of list) {
    const offer = offerSchema.safeParse(item);
    if (!offer.success || seen.has(offer.data.referenznummer)) continue;
    seen.add(offer.data.referenznummer);
    postings.push(postingFromOffer(offer.data));
  }
  const total = answer.data.maxErgebnisse ?? 0;
  return { postings, next: page * PAGE_SIZE < total && list.length > 0 ? `page:${page + 1}` : null };
}

/** The description from the details endpoint, else from the posting's page, else null. */
async function details(posting: FoundPosting, context: RequestContext = {}): Promise<string | null> {
  const url = new URL(`${context.baseUrl ?? BASE}${PATHS.details}${Buffer.from(posting.externalId).toString("base64")}`);
  try {
    const answer = detailsSchema.safeParse(await request(url, context));
    const text = answer.success ? fromMarkdown(answer.data.stellenangebotsBeschreibung) : "";
    if (text) return text;
  } catch (error) {
    if (!(error instanceof JobSearchError)) throw error;
  }
  if (!posting.url) return null;
  const page = await fetchPosting(posting.url);
  return page.ok ? page.text : null;
}

export const arbeitsagentur: JobSourceAdapter<"ARBEITSAGENTUR"> = {
  source: "ARBEITSAGENTUR",
  search: (query, _credentials, next, context) => searchPage(query, next, context),
  details: (posting, _credentials, context) => details(posting, context),
  test: async (_credentials, context) => {
    await searchPage({ keywords: "Softwareentwickler", place: "", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, null, context);
  },
};
