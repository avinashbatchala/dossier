import "server-only";

import { Agent, fetch as undiciFetch } from "undici";

import { cached, remember } from "@/lib/job-search/cache";
import { jobSearchError, JobSearchError, type ErrorInfo } from "@/lib/job-search/errors";
import { readLimited } from "@/lib/job-search/http";
import { workableFrom } from "@/lib/job-search/regions";
import { EMPTY_QUERY, experienceAskedFor, experienceRangeAskedFor, POSTED_WITHIN, safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "@/lib/job-search/search";
import { fetchPosting, guardedLookup } from "@/lib/posting-fetch";

import type { PortalConfig, PostingSpec } from "./format";
import { JOBPOSTING_SPEC, jobPostingsIn } from "./jobposting";
import { listEntries } from "./list-field";
import { allHold, EACH_NAME, fill, type Tables, type TemplateValues } from "./template";
import { at, numberOf, read, textOf, type ReadContext, type Value } from "./values";
import { parseXml } from "./xml";

// The one engine every portal runs on (E22-1, #387): it turns a config, the
// user's field values and a search into requests, and the answers into
// postings. Requests go only to the config's hosts (and a server field's),
// redirects only between them, and a key only where the config puts it.

/** The user's values for a portal's fields, by field name: { key: "…", host: "rapidapi" }. */
export type PortalFields = Readonly<Record<string, string>>;

type PortalContext = {
  /** Replaces the portal's address; for the end-to-end tests' fake portals. Its host is then allowed too. */
  baseUrl?: string;
  signal?: AbortSignal;
  /** For the local filter's "posted within". */
  now?: Date;
};

/** What a portal can do, in the shape the job search calls (src/lib/job-search/adapter.ts). */
export type PortalAdapter = {
  id: string;
  search: (query: SearchQuery, fields: PortalFields, next: string | null, context?: PortalContext) => Promise<SearchPage>;
  details: (posting: FoundPosting, fields: PortalFields, context?: PortalContext) => Promise<string | null>;
  test: (fields: PortalFields, context?: PortalContext) => Promise<void>;
};

const MAX_REDIRECTS = 3;
const ACCEPT: Record<PortalConfig["kind"], string> = {
  json: "application/json",
  feed: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
  jobposting: "text/html,application/xhtml+xml;q=0.9",
};

/** "app ID and key": how a portal's required fields are named in "Add your … first". */
function keyWords(config: PortalConfig): string {
  const labels = config.fields
    .filter((field) => (field.type === "secret" || field.type === "text" || field.type === "list") && field.required)
    .map((field) => (field.label.length > 1 && field.label[1] === field.label[1].toLowerCase() ? field.label[0].toLowerCase() + field.label.slice(1) : field.label));
  return labels.length > 0 ? labels.join(" and ") : "key";
}

export function errorInfo(config: PortalConfig): ErrorInfo {
  return { name: config.name, quotaPeriod: config.quota?.period ?? null, keyWords: keyWords(config) };
}

// ─── Requests ────────────────────────────────────────────────────────────────

type Field = PortalConfig["fields"][number];
type ChoiceField = Extract<Field, { type: "choice" }>;

const choiceOf = (field: ChoiceField, fields: PortalFields) =>
  field.options.find((option) => option.value === fields[field.name]) ?? field.options.find((option) => option.value === field.default) ?? field.options[0];

const trimSlash = (address: string) => address.replace(/\/+$/, "");

/** Where requests start: the test's address, a server field, a chosen option's, or the config's own. */
function baseOf(config: PortalConfig, fields: PortalFields, context: PortalContext): string {
  if (context.baseUrl) return trimSlash(context.baseUrl);
  for (const field of config.fields) {
    if (field.type === "server") return trimSlash(safeLink(fields[field.name]) || field.default);
    if (field.type === "choice") {
      const base = choiceOf(field, fields).base;
      if (base) return trimSlash(base);
    }
  }
  return trimSlash(config.base ?? "");
}

type Reach = {
  hosts: Set<string>;
  /** Hosts the user named themselves (a server field) or the tests did: these may answer over plain http. */
  ownHosts: Set<string>;
  /** A portal the user added (E23-3): its hosts are only reached when they're on the public internet. */
  guarded: boolean;
};

/** Connections that refuse private and local addresses, checked when connecting, so DNS can't point a config's host inside the network. */
let guardedAgent: Agent | undefined;
const guardedFetch = (url: URL, init: RequestInit): Promise<Response> =>
  undiciFetch(url, { ...(init as object), dispatcher: (guardedAgent ??= new Agent({ connect: { lookup: guardedLookup } })) }) as unknown as Promise<Response>;

const hostOf = (address: string | undefined) => (address && URL.canParse(address) ? new URL(address).hostname : null);

/** The hosts this portal may reach right now: the config's, and a server field's or the tests'. */
function reachOf(config: PortalConfig, fields: PortalFields, context: PortalContext, guarded: boolean): Reach {
  const hosts = new Set(config.hosts);
  const ownHosts = new Set<string>();
  const server = config.fields.find((field) => field.type === "server");
  for (const host of [hostOf(context.baseUrl), server ? hostOf(baseOf(config, fields, {})) : null]) {
    if (!host) continue;
    hosts.add(host);
    ownHosts.add(host);
  }
  return { hosts, ownHosts, guarded };
}

function queryValues(query: SearchQuery): Record<string, string> {
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  return {
    keywords: query.keywords,
    place: query.place,
    country: query.country,
    // Empty for any distance, so a radius parameter isn't sent (public #138).
    radiusKm: query.radiusKm === null ? "" : String(query.radiusKm),
    remoteOnly: query.remoteOnly ? "true" : "",
    postedWithin: query.postedWithin,
    postedDays: days ? String(days) : "",
    // A portal's own level filter takes one; a range is matched on the server (fitsExperience) instead (E24-6).
    level: (experienceRangeAskedFor(query) ?? []).length === 1 ? experienceAskedFor(query)! : "",
  };
}

function fieldValues(config: PortalConfig, fields: PortalFields): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of config.fields) {
    values[`fields.${field.name}`] = field.type === "choice" ? choiceOf(field, fields).value : (fields[field.name] ?? (field.type === "server" ? field.default : ""));
  }
  return values;
}

type Request = { url: string; headers: Record<string, string>; params: readonly { name: string; value: string; when?: string | string[] }[] };

function requestFor(config: PortalConfig, request: Request, values: TemplateValues, fields: PortalFields): { url: URL; headers: Record<string, string> } {
  const url = new URL(fill(request.url, values, config.maps, { inUrl: true }));
  for (const param of request.params) {
    if (!allHold(param.when, values)) continue;
    const value = fill(param.value, values, config.maps);
    if (value !== "") url.searchParams.append(param.name, value);
  }
  const headers: Record<string, string> = {};
  for (const [name, template] of Object.entries(request.headers)) headers[name] = fill(template, values, config.maps);
  for (const field of config.fields) {
    if (field.type !== "choice") continue;
    for (const [name, template] of Object.entries(choiceOf(field, fields).headers ?? {})) headers[name] = fill(template, values, config.maps);
  }
  return { url, headers };
}

const lastRequest = ((globalThis as { __dossierPortalLastRequest?: Map<string, number> }).__dossierPortalLastRequest ??= new Map());

/** Waits for the portal's minimum gap between requests. */
async function paced(config: PortalConfig, signal?: AbortSignal): Promise<void> {
  if (config.minGapSeconds <= 0) return;
  const wait = (lastRequest.get(config.id) ?? 0) + config.minGapSeconds * 1000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait).unref?.());
  signal?.throwIfAborted();
  lastRequest.set(config.id, Date.now());
}

/**
 * One request's answer as text. Every failure becomes a JobSearchError
 * worded for the screen; the detail for the log names the path and the
 * status, never the search.
 */
async function answerOf(config: PortalConfig, start: URL, headers: Record<string, string>, { hosts, ownHosts, guarded }: Reach, context: PortalContext): Promise<{ text: string; url: URL }> {
  const info = errorInfo(config);
  const fail = (problem: Parameters<typeof jobSearchError>[0], detail: string) => jobSearchError(problem, config.id, { detail, info });
  // Without a key of the user's, a refusal is the portal's doing, not a wrong key.
  const keyed = config.fields.some((field) => field.type === "secret");
  let url = start;
  for (let redirects = 0; ; redirects++) {
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ownHosts.has(url.hostname))) throw fail("changed", `${url.pathname}: not https`);
    if (!hosts.has(url.hostname)) throw fail("changed", `${url.pathname}: ${url.hostname} isn't in the config's hosts`);
    await paced(config, context.signal);
    const timeout = AbortSignal.timeout(config.timeoutSeconds * 1000);
    let response: Response;
    // A host the user or the tests named is theirs to reach; an added config's own hosts must be public.
    const send = guarded && !ownHosts.has(url.hostname) ? guardedFetch : fetch;
    try {
      response = await send(url, {
        headers: { accept: ACCEPT[config.kind], ...headers },
        signal: context.signal ? AbortSignal.any([context.signal, timeout]) : timeout,
        redirect: "manual",
        cache: "no-store",
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      if (code === "EPRIVATE") throw fail("changed", `${url.pathname}: ${url.hostname} is on a private network`);
      const reason = timeout.aborted ? "timed out" : (code ?? "request failed");
      throw fail("unavailable", `${url.pathname}: ${reason}`);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (redirects >= MAX_REDIRECTS) throw fail("changed", `${url.pathname}: too many redirects`);
      url = new URL(response.headers.get("location")!, url);
      continue;
    }
    const detail = `${url.pathname}: HTTP ${response.status}`;
    if (response.status === 401 || response.status === 403) throw fail(keyed ? "key" : "changed", detail);
    if (response.status === 429) throw fail("quota", detail);
    if (!response.ok) throw fail(response.status >= 500 ? "unavailable" : "changed", detail);
    const limit = config.maxMegabytes * 1024 * 1024;
    const text = await readLimited(response, limit);
    if (text === null) throw fail("changed", `${url.pathname}: answer over ${limit} bytes`);
    return { text, url };
  }
}

/** " (keys: data, status)": an answer's top-level keys tell a changed API from an error message, and never hold the search. */
function keysOf(answer: unknown): string {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return "";
  const keys = Object.keys(answer).slice(0, 10).map((key) => key.slice(0, 40));
  return keys.length > 0 ? ` (keys: ${keys.join(", ")})` : "";
}

/** The answer as data: JSON, a feed as an object, or a page's JobPostings as a list. */
function parsed(config: PortalConfig, text: string, url: URL): unknown {
  const changed = (what: string) => jobSearchError("changed", config.id, { detail: `${url.pathname}: ${what}`, info: errorInfo(config) });
  if (config.kind === "jobposting") return jobPostingsIn(text);
  if (config.kind === "feed") {
    const feed = parseXml(text);
    if (!feed) throw changed("not a feed");
    return feed;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw changed("not JSON");
  }
}

// ─── Postings ────────────────────────────────────────────────────────────────

function salaryOf(item: unknown, spec: PostingSpec["salary"], context: ReadContext): string {
  if (!spec) return "";
  const written = textOf(read(item, spec.text, context), 200);
  if (written) return written;
  const min = numberOf(read(item, spec.min, context)) || null;
  const max = numberOf(read(item, spec.max, context)) || null;
  if (min === null && max === null) return "";
  const amount = (value: number) => Math.round(value).toLocaleString("en-US");
  const range = min !== null && max !== null && Math.round(min) !== Math.round(max) ? `${amount(min)}–${amount(max)}` : amount((min ?? max)!);
  const period = textOf(read(item, spec.period, context), 40);
  const periods = spec.periods ?? {};
  const word = period ? (Object.entries(periods).find(([name]) => name.toLowerCase() === period.toLowerCase())?.[1] ?? "") : (spec.defaultPeriod ?? "");
  const estimated = read(item, spec.estimated, context) === true ? "(estimated)" : "";
  return [textOf(read(item, spec.currency, context), 10), range, word, estimated].filter(Boolean).join(" ").slice(0, 200);
}

const flag = (value: Value) => (value === true || value === false ? value : null);

function dateOf(value: Value): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsedDate = Date.parse(value);
  return Number.isNaN(parsedDate) ? null : new Date(parsedDate).toISOString();
}

/** One answer item as a posting, or null without an id. */
function postingOf(config: PortalConfig, item: unknown, values: TemplateValues): FoundPosting | null {
  const spec = config.search.posting ?? JOBPOSTING_SPEC;
  const tables: Tables = config.maps;
  const externalId = textOf(read(item, spec.id, { tables, values }), 500);
  if (!externalId) return null;
  const context: ReadContext = { tables, values: { ...values, id: externalId } };
  const text = (part: keyof PostingSpec, max: number) => textOf(read(item, spec[part] as Parameters<typeof read>[1], context), max);
  const description = text("description", 100_000);
  return {
    source: config.id,
    externalId,
    title: text("title", 500),
    company: text("company", 300),
    place: text("place", 300),
    remote: flag(read(item, spec.remote, context)),
    salary: salaryOf(item, spec.salary, context),
    postedAt: dateOf(read(item, spec.postedAt, context)),
    url: safeLink(text("url", 2000)).slice(0, 2000),
    via: text("via", 100),
    description,
    complete: spec.complete === "description" ? description.length > 0 : spec.complete,
  };
}

const normal = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * For a portal that returns everything: whether a posting fits the search.
 * The words are looked for in the title and the company only: a whole
 * posting has most words in it somewhere.
 */
function fitsLocally(posting: FoundPosting, query: SearchQuery, now: Date): boolean {
  const haystack = ` ${normal([posting.title, posting.company].join(" "))} `;
  if (!normal(query.keywords).split(" ").filter(Boolean).every((word) => haystack.includes(` ${word}`))) return false;
  if (query.remoteOnly && posting.remote !== true) return false;
  if (query.place && posting.remote !== true && !normal(posting.place).includes(normal(query.place))) return false;
  // "USA only", "Berlin, Germany": a posting that names other places isn't one to apply for from here.
  if (query.country && !workableFrom(posting.place, query.country)) return false;
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  if (days && posting.postedAt && now.getTime() - Date.parse(posting.postedAt) > days * 86_400_000) return false;
  return true;
}

// ─── Paging ──────────────────────────────────────────────────────────────────

/** The page asked for, from the `next` of the page before ("cursor:…", "page:2", "offset:40"). */
function pageValues(paging: PortalConfig["search"]["paging"], next: string | null): Record<string, string> {
  if (paging.type === "cursor") return { cursor: next?.startsWith("cursor:") ? next.slice("cursor:".length) : "" };
  if (paging.type === "page") {
    const page = next?.startsWith("page:") ? Math.max(paging.first, Number(next.slice("page:".length)) || paging.first) : paging.first;
    return { page: String(page), size: String(paging.size) };
  }
  if (paging.type === "offset") {
    const offset = next?.startsWith("offset:") ? Math.max(0, Number(next.slice("offset:".length)) || 0) : 0;
    return { offset: String(offset), size: String(paging.size) };
  }
  return {};
}

function nextOf(paging: PortalConfig["search"]["paging"], answer: unknown, items: number, values: Record<string, string>): string | null {
  if (paging.type === "cursor") {
    const cursor = textOf(read(answer, paging.path, { tables: {}, values: {} }), 2000);
    return cursor ? `cursor:${cursor}` : null;
  }
  const total = (path: string | undefined) => (path ? numberOf(read(answer, path, { tables: {}, values: {} })) : null);
  if (paging.type === "page") {
    const page = Number(values.page);
    const counted = (page - paging.first + 1) * paging.size;
    return counted < (total(paging.total) ?? 0) && items > 0 ? `page:${page + 1}` : null;
  }
  if (paging.type === "offset") {
    const after = Number(values.offset) + paging.size;
    const known = total(paging.total);
    const more = (paging.max === undefined || after + paging.size <= paging.max) && (known !== null ? after < known : items >= paging.size);
    return more ? `offset:${after}` : null;
  }
  return null;
}

// ─── The adapter ─────────────────────────────────────────────────────────────

/** Downloads of kept answers under way, by the answer's key, so searches at the same time share one. */
const downloads: Map<string, Promise<SearchPage>> = ((globalThis as { __dossierPortalDownloads?: Map<string, Promise<SearchPage>> }).__dossierPortalDownloads ??= new Map());

/** "acme, globex and initech", or "acme, globex, initech and 4 more". */
function namesOf(names: readonly string[]): string {
  const shown = names.length > 5 ? [...names.slice(0, 4), `${names.length - 4} more`] : [...names];
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : (shown[0] ?? "");
}

/**
 * The adapter for a config. `guarded`, for a portal the user added (E23-3):
 * its hosts are reached only when they resolve to the public internet.
 */
export function portalAdapter(config: PortalConfig, { guarded = false }: { guarded?: boolean } = {}): PortalAdapter {
  const info = errorInfo(config);

  /** One answer's postings, read whole, and the page after it. */
  async function ask(url: URL, headers: Record<string, string>, values: TemplateValues, fields: PortalFields, context: PortalContext): Promise<SearchPage> {
    const answer = await answerOf(config, url, headers, reachOf(config, fields, context, guarded), context);
    const data = parsed(config, answer.text, answer.url);

    const found = (config.kind === "jobposting" && !config.search.items) || config.search.items === "$" ? data : at(data, config.search.items!);
    let items: unknown[];
    if (Array.isArray(found)) items = found;
    else if (found === undefined || found === null) {
      if (!config.search.itemsMayBeMissing) throw jobSearchError("changed", config.id, { detail: `${answer.url.pathname}: unexpected answer${keysOf(data)}`, info });
      items = [];
    } else if (config.kind === "feed" && typeof found === "object") items = [found];
    else throw jobSearchError("changed", config.id, { detail: `${answer.url.pathname}: unexpected answer${keysOf(data)}`, info });

    const seen = new Set<string>();
    const postings: FoundPosting[] = [];
    for (const item of items) {
      const posting = postingOf(config, item, values);
      if (!posting || seen.has(posting.externalId)) continue;
      seen.add(posting.externalId);
      postings.push(posting);
    }
    return { postings, next: nextOf(config.search.paging, data, items.length, values) };
  }

  /**
   * One request's page. A portal whose answers are kept (`keepMinutes`, a
   * feed read whole) downloads once for every search until then, and
   * searches asking at the same time share that download.
   */
  async function pageOf(values: TemplateValues, fields: PortalFields, context: PortalContext): Promise<SearchPage> {
    const { url, headers } = requestFor(config, config.search, values, fields);
    const keep = config.search.keepMinutes;
    if (keep <= 0) return ask(url, headers, values, fields, context);
    const key = `portal-answer:${config.id}@${config.version}:${url.href}:${JSON.stringify(headers)}`;
    const hit = cached<SearchPage>(key);
    if (hit) return hit;
    const running = downloads.get(key);
    if (running) return running;
    // Shared, so one search stopping doesn't stop it for the others; the timeout still holds.
    const download = ask(url, headers, values, fields, { ...context, signal: undefined })
      .then((page) => {
        remember(key, page, Date.now(), keep * 60_000);
        return page;
      })
      .finally(() => downloads.delete(key));
    downloads.set(key, download);
    return download;
  }

  /**
   * A search for each entry of a list field (`search.each`), a few at a
   * time: the answers make one page. An entry that can't be read is skipped
   * and named; when none can be, the search fails.
   */
  async function forEach(values: TemplateValues, fields: PortalFields, context: PortalContext): Promise<SearchPage & { unread: string[] }> {
    const each = config.search.each!;
    const field = config.fields.find((candidate) => candidate.name === each.field);
    const { entries } = listEntries(fields[each.field] ?? "", field?.type === "list" ? field.max : 25);
    if (entries.length === 0) throw jobSearchError("no-key", config.id, { info });
    const answers: ({ ok: true; page: SearchPage } | { ok: false; error: JobSearchError })[] = [];
    let index = 0;
    const work = async () => {
      for (let at = index++; at < entries.length; at = index++) {
        try {
          answers[at] = { ok: true, page: await pageOf({ ...values, [EACH_NAME]: entries[at] }, fields, context) };
        } catch (error) {
          if (!(error instanceof JobSearchError)) throw error;
          answers[at] = { ok: false, error };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(each.atOnce, entries.length) }, work));

    const unread = entries.filter((_, at) => !answers[at].ok);
    const errors = answers.flatMap((answer) => (answer.ok ? [] : [answer.error]));
    if (unread.length === entries.length) {
      // Every one answered "not here": the names are wrong, not the portal. Like a wrong key, it's the
      // user's to fix, so it isn't logged (the names are theirs).
      if (errors.every((error) => error.problem === "changed")) throw new JobSearchError("key", `${config.name} couldn't read ${namesOf(unread)}. Check ${unread.length === 1 ? "it" : "them"} in Settings → Job search.`);
      throw errors.find((error) => error.problem !== "changed") ?? errors[0];
    }
    const seen = new Set<string>();
    const postings = answers.flatMap((answer) => (answer.ok ? answer.page.postings : [])).filter((posting) => !seen.has(posting.externalId) && (seen.add(posting.externalId), true));
    return { postings, next: null, unread };
  }

  async function search(query: SearchQuery, fields: PortalFields, next: string | null, context: PortalContext = {}): Promise<SearchPage> {
    const values = { ...queryValues(query), ...pageValues(config.search.paging, next), ...fieldValues(config, fields), base: baseOf(config, fields, context) };
    const { postings: found, next: following, unread } = config.search.each ? await forEach(values, fields, context) : { ...(await pageOf(values, fields, context)), unread: [] };
    const postings = config.search.localFilter ? found.filter((posting) => fitsLocally(posting, query, context.now ?? new Date())) : found;
    return { postings, next: following, ...(unread.length > 0 ? { note: `Couldn't read ${namesOf(unread)}.` } : {}) };
  }

  async function details(posting: FoundPosting, fields: PortalFields, context: PortalContext = {}): Promise<string | null> {
    const how = config.details;
    if (how.type === "none") return posting.description ? posting.description : null;
    if (how.type === "request") {
      const values = { ...fieldValues(config, fields), base: baseOf(config, fields, context), id: posting.externalId };
      try {
        const { url, headers } = requestFor(config, how, values, fields);
        const answer = await answerOf(config, url, headers, reachOf(config, fields, context, guarded), context);
        const text = textOf(read(parsed(config, answer.text, answer.url), how.description, { tables: config.maps, values }), 100_000);
        if (text) return text;
      } catch (error) {
        if (!(error instanceof JobSearchError)) throw error;
      }
      if (!how.thenPage) return null;
    }
    // The posting's own page, read like Fetch reads a pasted link: guarded, and with nothing from the fields.
    if (!posting.url) return null;
    const page = await fetchPosting(posting.url);
    // Menus or links rather than a posting (#232): the portal's own snippet is better.
    return page.ok && !page.doubtful ? page.text : null;
  }

  async function test(fields: PortalFields, context: PortalContext = {}): Promise<void> {
    const query = { ...EMPTY_QUERY, keywords: config.test.keywords, place: config.test.place, country: config.test.country };
    if (!config.search.each) return void (await search(query, fields, null, context));
    // Every entry is asked, so a name that's wrong is named.
    const { unread } = await forEach({ ...queryValues(query), ...fieldValues(config, fields), base: baseOf(config, fields, context) }, fields, context);
    if (unread.length > 0) throw new JobSearchError("key", `${config.name} couldn't read ${namesOf(unread)}. Check ${unread.length === 1 ? "it" : "them"}; the rest work.`);
  }

  return { id: config.id, search, details, test };
}
