import "server-only";

import { logServerError } from "@/lib/log";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { cached, remember } from "./cache";
import { JobSearchError, jobSearchError } from "./errors";
import { adzuna } from "./adzuna";
import { arbeitsagentur } from "./arbeitsagentur";
import { freehire } from "./freehire";
import { jsearch } from "./jsearch";
import { postingKey, type FoundPosting, type JobSource, type SearchPage, type SearchQuery } from "./search";
import { sourceCovers } from "./sources";

// Searching the chosen job source from the server (E14-1). Results are
// cached for half an hour; failures come back as JobSearchError with a
// message for the screen, and the ones that point at a problem with the
// source are logged, without the search.

export type { JSearchHost, RequestContext, SourceCredentials } from "./adapter";
export { JobSearchError } from "./errors";

const ADAPTERS: { [S in JobSource]: JobSourceAdapter<S> } = {
  JSEARCH: jsearch,
  ADZUNA: adzuna,
  ARBEITSAGENTUR: arbeitsagentur,
  FREEHIRE: freehire,
};

const adapterFor = <S extends JobSource>(source: S) => ADAPTERS[source] as JobSourceAdapter<S>;

/** Logs failures that say something about the source; a wrong key or a used-up quota is the user's to fix. */
async function logged<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof JobSearchError && (error.problem === "changed" || error.problem === "unavailable")) {
      logServerError("job search", new Error(error.detail ?? error.message));
    }
    throw error;
  }
}

/** One page of postings for `query` from `source`, from the cache when it was asked for in the last half hour. */
export async function searchPostings<S extends JobSource>(
  source: S,
  credentials: SourceCredentials[S],
  query: SearchQuery,
  next: string | null = null,
  context: RequestContext = {},
): Promise<SearchPage> {
  if (!sourceCovers(source, query.country)) throw jobSearchError("country", source, { country: query.country });
  const adapter = adapterFor(source);
  const key = `search:${source}:${JSON.stringify(query)}:${next ?? ""}`;
  const hit = cached<SearchPage>(key);
  if (hit) return hit;
  const page = await logged(() => adapter.search(query, credentials, next, context));
  remember(key, page);
  return page;
}

/** The whole text of a posting: its own description when that's complete, else fetched; null when it can't be had. */
export async function postingDetails<S extends JobSource>(
  source: S,
  credentials: SourceCredentials[S],
  posting: FoundPosting,
  context: RequestContext = {},
): Promise<string | null> {
  if (posting.complete) return posting.description;
  const key = `details:${postingKey(posting)}`;
  const hit = cached<string>(key);
  if (hit) return hit;
  const text = await logged(() => adapterFor(source).details(posting, credentials, context));
  if (text) remember(key, text);
  return text;
}

/** "Test connection" in Settings → Job search: throws a JobSearchError when the source or the key doesn't work. */
export async function testSource<S extends JobSource>(source: S, credentials: SourceCredentials[S], context: RequestContext = {}): Promise<void> {
  await logged(() => adapterFor(source).test(credentials, context));
}
