import { z } from "zod";

import { daysBetween, formatShortCalendarDate } from "@/lib/dates";
import type { PostingFit } from "@/lib/fit";
import { byBestFit, COVERS, coverageOf, type Covers } from "@/lib/posting-coverage";

import { countryCodeFor } from "./countries";
import { sourceInfo } from "./sources";

export { isJobSource } from "./sources";

// Job search (E14): what a search asks for and what a posting looks like,
// whichever source answers. Shared by the server and the Find jobs screen.
// In this code "job" already means a background task (src/lib/jobs), so a
// job ad is a "posting".

/** The job sources Dossier can search (E14-1 to E14-3, FreeHire), in the order Settings lists them; one is chosen there. */
/** The built-in portals' ids. */
export const JOB_SOURCES = ["JSEARCH", "ADZUNA", "FREEHIRE", "ARBEITSAGENTUR"] as const;
/** A portal's id: a built-in's, or one the user added (E23-3). */
export type JobSource = string;

/**
 * A source's id as rows store it (#269): text, so a source that's no longer
 * listed still has its past searches and saved postings, under the same id.
 */
export const sourceIdSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);

/** Where a JSearch key comes from: OpenWeb Ninja directly, or the RapidAPI marketplace. */
export const JSEARCH_HOSTS = ["openwebninja", "rapidapi"] as const;
export type JSearchHost = (typeof JSEARCH_HOSTS)[number];

/** How far from the place to look, in km (E14-6). */
export const RADII_KM = [10, 25, 50, 100, 200] as const;
export type RadiusKm = (typeof RADII_KM)[number];
export const DEFAULT_RADIUS_KM: RadiusKm = 25;

/** How recent the postings must be, with the days each choice allows. */
export const POSTED_WITHIN = [
  { value: "any", label: "Any time", days: null },
  { value: "day", label: "Past day", days: 1 },
  { value: "3days", label: "Past 3 days", days: 3 },
  { value: "week", label: "Past week", days: 7 },
  { value: "month", label: "Past month", days: 30 },
] as const;
export type PostedWithin = (typeof POSTED_WITHIN)[number]["value"];
const POSTED_VALUES = POSTED_WITHIN.map((option) => option.value) as [PostedWithin, ...PostedWithin[]];

/** The experience level a search asks for (public issue 59); "any" or none leaves it open. */
export const EXPERIENCE_LEVELS = [
  { value: "any", label: "Any level" },
  { value: "intern", label: "Internship" },
  { value: "junior", label: "Entry level" },
  { value: "mid", label: "Mid level" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead or director" },
] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]["value"];
const LEVEL_VALUES = EXPERIENCE_LEVELS.map((option) => option.value) as [ExperienceLevel, ...ExperienceLevel[]];

/** One search, as every source gets it. */
export const searchQuerySchema = z.object({
  keywords: z.string().trim().max(200),
  /** A city or region; empty searches the whole country. */
  place: z.string().trim().max(200),
  /** ISO 3166-1 alpha-2 in lower case, e.g. "de"; empty until one is chosen. */
  country: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^([a-z]{2})?$/),
  /** Null for any distance: no radius is sent, for a portal where one breaks the search (public #138). */
  radiusKm: z.literal(RADII_KM).nullable(),
  remoteOnly: z.boolean(),
  postedWithin: z.enum(POSTED_VALUES),
  /** Missing in searches from before 1.12.0, which means any. */
  experience: z.enum(LEVEL_VALUES).optional(),
  /** The highest level, when the search asks for a range from `experience` (E24-6), such as a profile's "Senior to Lead or director". */
  experienceTo: z.enum(LEVEL_VALUES).optional(),
});
export type SearchQuery = z.output<typeof searchQuerySchema>;

/** The level a search asks for, the lowest of a range, or null for any. */
export const experienceAskedFor = (query: Pick<SearchQuery, "experience">): Exclude<ExperienceLevel, "any"> | null =>
  query.experience && query.experience !== "any" ? query.experience : null;

/** The levels a search asks for (E24-6): one, a range from `experience` to `experienceTo`, or null for any. */
export function experienceRangeAskedFor(query: Pick<SearchQuery, "experience" | "experienceTo">): Exclude<ExperienceLevel, "any">[] | null {
  const from = experienceAskedFor(query);
  if (!from) return null;
  const steps = LEVEL_VALUES.filter((value) => value !== "any") as Exclude<ExperienceLevel, "any">[];
  const to = query.experienceTo && query.experienceTo !== "any" ? query.experienceTo : from;
  const [a, b] = [steps.indexOf(from), steps.indexOf(to)].sort((x, y) => x - y);
  return steps.slice(a, b + 1);
}

export const EMPTY_QUERY: SearchQuery = {
  keywords: "",
  place: "",
  country: "",
  radiusKm: DEFAULT_RADIUS_KM,
  remoteOnly: false,
  postedWithin: "any",
};

/** A posting as a source found it, in one shape for every source. */
export const foundPostingSchema = z.object({
  /** The source's id: one of JOB_SOURCES when it was found, but a stored one may no longer be listed (#269). */
  source: sourceIdSchema,
  /** The source's own id for it. */
  externalId: z.string().min(1).max(500),
  title: z.string().max(500),
  company: z.string().max(300),
  place: z.string().max(300),
  /** Null when the source doesn't say. */
  remote: z.boolean().nullable(),
  /** As the source writes it, e.g. "EUR 60,000–75,000 a year"; empty when there's none. */
  salary: z.string().max(200),
  postedAt: z.iso.datetime().nullable(),
  /** Where to read it or apply: always http(s), or empty. */
  url: z
    .string()
    .max(2000)
    .refine((url) => url === "" || safeLink(url) !== "", "Not a web address."),
  /** Where the source found it, e.g. "LinkedIn"; empty when it's the source's own. */
  via: z.string().max(100),
  /** Plain text. */
  description: z.string().max(100_000),
  /** False while the description is only the start of the posting. */
  complete: z.boolean(),
});
export type FoundPosting = z.output<typeof foundPostingSchema>;

/** A page of results, and what to ask for the next page (null on the last one). */
export type SearchPage = {
  postings: FoundPosting[];
  next: string | null;
  /** Said with the portal's count, in words for the screen: "Couldn't read acme." */
  note?: string;
};

/**
 * A posting's score against one profile (E25-5). `profileName` is empty with
 * only one profile; `older`: scored before scores showed how they add up (E25-6).
 */
export type ProfileFit = PostingFit & { profileId: string; profileName: string; older?: boolean };

/** The best of a posting's scores: the best coverage (E32-2), the first profile's on a tie. */
export const bestFit = (scores: readonly ProfileFit[]): ProfileFit | null =>
  scores.reduce<ProfileFit | null>((best, fit) => (best === null || byBestFit({ coverage: coverageOf(fit), at: 0 }, { coverage: coverageOf(best), at: 0 }) < 0 ? fit : best), null);

/** Where a posting stands for the user (E14-5). */
export type PostingState = {
  /** Its row, when it's stored. */
  postingId: string | null;
  /** In the library and not yet opened or acted on (E22-5). */
  new: boolean;
  saved: boolean;
  dismissed: boolean;
  /** The application made from it, or from the same link before Find jobs. */
  applicationId: string | null;
  /** Its best score of the profiles it was scored against (#208, E25-5), or null before it's scored. */
  score: ProfileFit | null;
  /** Its score for each profile it was scored against, in the profiles' order (E25-5). */
  scores: ProfileFit[];
  /** The portals it was found on, with the link each gave (E22-6): its own first, then those of postings found to be the same job. */
  foundOn: { portal: string; url: string }[];
  /** In the Archive (E22-7). */
  archived: boolean;
  /** When a search found it again while in the Archive: "Still listed". */
  stillListedAt: string | null;
  /** The job agent's searches that found it, by name: "Found by the agent · <name>" (E22-8). */
  agentSearches: string[];
  /** Where it stands with the job agent, when the agent scored it: Prepare draft, or its draft. */
  agent: { candidateId: string; status: "SCORED" | "DRAFTING" | "DRAFTED" | "APPROVED" | "DISMISSED"; applicationId: string | null } | null;
};

/** A posting as Find jobs shows it. */
export type ShownPosting = FoundPosting & { state: PostingState };

/** What went wrong with a search, in words for the screen (E14-6). */
export type SearchProblem = { ok: false; problem: "off" | "not-accepted" | "no-country" | "no-key" | "key" | "quota" | "country" | "unavailable" | "changed"; message: string };

/** A search kept with what it found (E14-10), as Find jobs opens it. */
export type StoredSearch = {
  id: string;
  /** Possibly a source that's no longer listed (#269); then `next` is null. */
  source: string;
  query: SearchQuery;
  /** "today at 14:32", "yesterday at 09:05", "on Thu 1 Oct at 18:20", in the user's time zone. */
  ranAt: string;
  postings: ShownPosting[];
  /** The first portal's next page; null when it has none (and for a source no longer listed). */
  next: string | null;
  /** Each portal it asked and where it stands (E22-4). */
  portals: SearchPortal[];
  /** Its background job while portals are still searching (E22-4); null once they're done. */
  jobId: string | null;
};

/** A search in the Past searches list, grouped by the day it ran. */
export type PastSearchDay = {
  /** "Today", "Yesterday" or "Thu 1 Oct". */
  day: string;
  searches: { id: string; source: string; query: SearchQuery; found: number; time: string }[];
};

/** "product designer · Hamburg, 25 km · Remote only · Past week": a search in a line, without the km for a source that has no radius. */
/** A search as the source bar's chips (E32-3): what, where, the country, remote, levels and how recent. */
export function searchChips(query: SearchQuery, countryName: string, source?: string | null): string[] {
  const withoutKm = query.radiusKm === null || (source && !sourceInfo(source).radius);
  const levels = (experienceRangeAskedFor(query) ?? []).map((value) => EXPERIENCE_LEVELS.find((option) => option.value === value)!.label);
  const posted = POSTED_WITHIN.find((option) => option.value === query.postedWithin);
  return [
    query.keywords,
    query.place ? (withoutKm ? query.place : `${query.place} + ${query.radiusKm} km`) : "",
    countryName,
    query.remoteOnly ? "Remote only" : "",
    levels.length > 1 ? `${levels[0]} to ${levels.at(-1)}` : (levels[0] ?? ""),
    posted && posted.value !== "any" ? posted.label : "Any time",
  ].filter(Boolean);
}

export function describeSearch(query: SearchQuery, countryName: string, source?: string | null): string {
  const withoutKm = query.radiusKm === null || (source && !sourceInfo(source).radius);
  const where = query.place ? (withoutKm ? query.place : `${query.place}, ${query.radiusKm} km`) : countryName;
  const posted = POSTED_WITHIN.find((option) => option.value === query.postedWithin);
  const levels = (experienceRangeAskedFor(query) ?? []).map((value) => EXPERIENCE_LEVELS.find((option) => option.value === value)!.label);
  const level = levels.length > 1 ? `${levels[0]} to ${levels.at(-1)}` : (levels[0] ?? "");
  return [query.keywords, where, query.remoteOnly ? "Remote only" : "", posted && posted.value !== "any" ? posted.label : "", level].filter(Boolean).join(" · ");
}

/** Identifies a posting across searches. */
export const postingKey = (posting: { source: string; externalId: string }) => `${posting.source}:${posting.externalId}`;

/** A link from a source, kept only when it's a web address, so it can't run script as an href. */
export function safeLink(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

// Query parameters that only say where a click came from.
const TRACKING = /^(utm_.*|trackingid|refid|ref|src|source|from|gh_src|lever-source|trk|trkinfo|sid|campaign|cmp|mc_cid|mc_eid|fbclid|gclid|msclkid|originalsubdomain)$/i;

/**
 * A link reduced to what identifies the page, so a posting found in Find
 * jobs matches an application made from the same link: host without "www.",
 * path, and the query without tracking parameters. "" when it isn't a link.
 */
export function linkKey(link: string): string {
  try {
    const url = new URL(link.trim());
    const params = [...url.searchParams].filter(([name]) => !TRACKING.test(name)).sort(([a], [b]) => a.localeCompare(b));
    const query = new URLSearchParams(params).toString();
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

// ─── In the URL ──────────────────────────────────────────────────────────────
// /jobs?q=designer&where=Hamburg&country=de&radius=25&remote=1&posted=week&level=senior, so
// Back, a reload or a bookmark show the same search.

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The search in the URL, or null when there's none (no keywords). */
export function queryFromParams(params: Record<string, string | string[] | undefined>): SearchQuery | null {
  const keywords = one(params.q).trim();
  if (!keywords) return null;
  const radius = Number(one(params.radius));
  const posted = POSTED_VALUES.find((value) => value === one(params.posted));
  const level = LEVEL_VALUES.find((value) => value === one(params.level));
  const levelTo = LEVEL_VALUES.find((value) => value === one(params.levelTo));
  const country = one(params.country).trim().toLowerCase();
  return {
    keywords: keywords.slice(0, 200),
    place: one(params.where).trim().slice(0, 200),
    country: /^[a-z]{2}$/.test(country) ? country : "",
    radiusKm: one(params.radius) === "any" ? null : (RADII_KM.find((km) => km === radius) ?? DEFAULT_RADIUS_KM),
    remoteOnly: one(params.remote) === "1",
    postedWithin: posted ?? "any",
    ...(level && level !== "any" ? { experience: level } : {}),
    ...(level && level !== "any" && levelTo && levelTo !== "any" && levelTo !== level ? { experienceTo: levelTo } : {}),
  };
}

// ─── The positions library (E22-5) ──────────────────────────────────────────

/** Where a portal stands in a search (E22-4): waiting its turn, asked, answered, failed or skipped, and why. */
const SEARCH_PORTAL_STATUSES = ["waiting", "searching", "done", "failed", "skipped"] as const;
export const searchPortalSchema = z.object({
  id: sourceIdSchema,
  status: z.enum(SEARCH_PORTAL_STATUSES),
  found: z.number().int().min(0).catch(0),
  /** What to ask it for next; null when it has no more. */
  next: z.string().nullable().catch(null),
  /** Why it failed or was skipped, or a note with what it found, in words for the screen. */
  message: z.string().nullable().catch(null),
  /** What kind of problem stopped it (SearchProblem's), for Settings' status (E34-1); missing before then. */
  problem: z.string().optional().catch(undefined),
});
export type SearchPortal = z.output<typeof searchPortalSchema>;

/**
 * "14 of 20 portals answered · 2 failed · 4 still searching": a search's
 * progress in a line, for its job's step and the screen.
 */
export function portalsLine(portals: readonly SearchPortal[]): string {
  const count = (status: SearchPortal["status"]) => portals.filter((portal) => portal.status === status).length;
  const asked = portals.filter((portal) => portal.status !== "skipped").length;
  const waiting = count("waiting") + count("searching");
  return [
    `${count("done")} of ${asked} ${asked === 1 ? "portal" : "portals"} answered`,
    count("failed") > 0 ? `${count("failed")} failed` : "",
    waiting > 0 ? `${waiting} still searching` : "",
    count("skipped") > 0 ? `${count("skipped")} skipped` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}


/** Which postings the library shows: the open ones (not dismissed), only new ones, or one kind. */
export const LIBRARY_SHOWS = [
  { value: "open", label: "All open" },
  { value: "new", label: "New" },
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied for" },
  { value: "dismissed", label: "Dismissed" },
] as const;
export type LibraryShow = (typeof LIBRARY_SHOWS)[number]["value"];
const SHOW_VALUES = LIBRARY_SHOWS.map((option) => option.value) as readonly string[];


/** The library's filters (E22-5); in the URL as tab, show, found, portal, age, score and fits. */
export type LibraryFilters = {
  /** Positions, or the Archive of postings left untouched (E22-7). */
  tab: "positions" | "archive";
  show: LibraryShow;
  /** The search that found it, or FOUND_BY_AGENT for any of the job agent's (E22-8). */
  found: string | null;
  portal: string | null;
  /** How recently it was posted. */
  age: PostedWithin;
  /** "Covers" (E32-2): how much of its requirements the profile must cover. */
  covers: Covers;
  /** "Fits" (E25-5): a profile whose coverage the Covers filter and the order go by, or null for each posting's best. */
  fits: string | null;
  /** "Best fit" (E32-2), or the newest found first. */
  sort: LibrarySort;
};

export const LIBRARY_SORTS = ["fit", "new"] as const;
type LibrarySort = (typeof LIBRARY_SORTS)[number];

/** "Found by the agent": what any of the job agent's searches found, best score first (E22-8). */
export const FOUND_BY_AGENT = "agent";

/** The searches a "found" filter names: one, or an agent run's several, by comma (E26-4); null for the agent's or none. */
export const foundSearchIds = (found: string | null): string[] | null =>
  found && found !== FOUND_BY_AGENT ? found.split(",").map((id) => id.trim()).filter(Boolean) : null;

export const DEFAULT_FILTERS: LibraryFilters = { tab: "positions", show: "open", found: null, portal: null, age: "any", covers: "any", fits: null, sort: "fit" };

/**
 * The library's filters in the URL. Links from before E22-5 still work:
 * ?view=saved and ?view=dismissed are those, and ?search=<id> is "found by".
 */
export function libraryFromParams(params: Record<string, string | string[] | undefined>): LibraryFilters {
  const view = one(params.view);
  const show = one(params.show) || (view === "saved" || view === "dismissed" ? view : "");
  const portal = one(params.portal).trim().toUpperCase();
  // ?score= from before coverage (E32-2): 70 is "at least half", 85 "at least two thirds".
  const score = Number(one(params.score));
  const covers = COVERS.find((value) => value === one(params.covers)) ?? (score >= 85 ? "two-thirds" : score >= 70 ? "half" : "any");
  return {
    tab: one(params.tab) === "archive" ? "archive" : "positions",
    show: SHOW_VALUES.includes(show) ? (show as LibraryShow) : "open",
    found: (one(params.found) || one(params.search)).trim().slice(0, 300) || null,
    portal: sourceIdSchema.safeParse(portal).success ? portal : null,
    age: POSTED_VALUES.find((value) => value === one(params.age)) ?? "any",
    covers,
    fits: one(params.fits).trim().slice(0, 100) || null,
    sort: one(params.sort) === "new" ? "new" : "fit",
  };
}

/** The Positions URL for some filters, leaving out the defaults. */
export function libraryHref(filters: Partial<LibraryFilters>): string {
  const params = new URLSearchParams();
  if (filters.tab === "archive") params.set("tab", "archive");
  if (filters.show && filters.show !== "open") params.set("show", filters.show);
  if (filters.found) params.set("found", filters.found);
  if (filters.portal) params.set("portal", filters.portal);
  if (filters.age && filters.age !== "any") params.set("age", filters.age);
  if (filters.covers && filters.covers !== "any") params.set("covers", filters.covers);
  if (filters.fits) params.set("fits", filters.fits);
  if (filters.sort === "new") params.set("sort", "new");
  const query = params.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

/** Find jobs' views: the search, past searches (E14-10), and the postings kept from them (E14-7). */
export type JobsView = "search" | "history" | "saved" | "dismissed";

export function viewFromParams(params: Record<string, string | string[] | undefined>): JobsView {
  const view = one(params.view);
  return view === "history" || view === "saved" || view === "dismissed" ? view : "search";
}

export const viewHref = (view: "history" | "saved" | "dismissed") => `/jobs?view=${view}`;

/** The Find jobs URL for a search. */
export function searchHref(query: SearchQuery): string {
  const params = new URLSearchParams({ q: query.keywords });
  if (query.place) params.set("where", query.place);
  if (query.country) params.set("country", query.country);
  if (query.radiusKm !== DEFAULT_RADIUS_KM) params.set("radius", query.radiusKm === null ? "any" : String(query.radiusKm));
  if (query.remoteOnly) params.set("remote", "1");
  if (query.postedWithin !== "any") params.set("posted", query.postedWithin);
  const levels = experienceRangeAskedFor(query);
  if (levels) {
    params.set("level", levels[0]);
    if (levels.length > 1) params.set("levelTo", levels.at(-1)!);
  }
  return `/jobs?${params.toString()}`;
}

// ─── For the screen ──────────────────────────────────────────────────────────

type Role = { role: string; current: boolean; startYear: number | null; startMonth: number | null; endYear: number | null; endMonth: number | null };

const monthOf = (year: number | null, month: number | null) => (year === null ? -1 : year * 12 + (month ?? 1));

/** The role to search for first: the current one, else the one that ended last; "" without any. */
export function latestRole(experience: readonly Role[]): string {
  const named = experience.filter((entry) => entry.role.trim());
  const latest = named.toSorted(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      monthOf(b.endYear, b.endMonth) - monthOf(a.endYear, a.endMonth) ||
      monthOf(b.startYear, b.startMonth) - monthOf(a.startYear, a.startMonth),
  )[0];
  return latest?.role.trim() ?? "";
}

/** The first search on Find jobs (E14-6): that role, in the profile's city and country. */
export function defaultSearch({ role, city, country }: { role: string; city: string; country: string }): SearchQuery {
  return { ...EMPTY_QUERY, keywords: role.trim().slice(0, 200), place: city.trim().slice(0, 200), country: countryCodeFor(country) };
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", or the date for older postings; "" without a date. */
export function postedAgo(postedAt: string | null, now: Date): string {
  if (!postedAt) return "";
  const posted = new Date(postedAt);
  const days = daysBetween(posted, now, "UTC");
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 31) return days < 14 ? "1 week ago" : `${Math.floor(days / 7)} weeks ago`;
  return formatShortCalendarDate(posted, now);
}

// ─── As a posting to paste ───────────────────────────────────────────────────

/**
 * The posting as New application gets it (E14-8): company and title, the
 * facts, then the description, laid out like a fetched posting
 * (src/lib/posting-fetch.ts).
 */
export function postingText(posting: Pick<FoundPosting, "title" | "company" | "place" | "remote" | "salary" | "description">): string {
  const facts = [posting.place, posting.remote ? "Remote" : "", posting.salary].filter(Boolean);
  return [[posting.company, posting.title].filter(Boolean).join(": "), facts.join(" · "), posting.description.trim()]
    .filter(Boolean)
    .join("\n\n");
}
