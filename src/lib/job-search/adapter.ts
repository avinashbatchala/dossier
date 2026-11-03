import "server-only";

import type { FoundPosting, JobSource, JSearchHost, SearchPage, SearchQuery } from "./search";

// What every job source implements (E14-1). Adapters turn a source's own
// request and answer into the shared query and posting shapes, and every
// failure into a JobSearchError.

export type { JSearchHost };

/** What each source needs to be asked. */
export type SourceCredentials = {
  JSEARCH: { key: string; host: JSearchHost };
  ADZUNA: { appId: string; key: string };
  ARBEITSAGENTUR: Record<string, never>;
  FREEHIRE: Record<string, never>;
};

export type RequestContext = {
  /** Replaces the source's own address; for the end-to-end tests' fake source. */
  baseUrl?: string;
  signal?: AbortSignal;
};

export type JobSourceAdapter<S extends JobSource> = {
  source: S;
  /** One page of results (the countries it covers are checked before, see SOURCE_INFO); `next` comes from the page before, null for the first. */
  search: (query: SearchQuery, credentials: SourceCredentials[S], next: string | null, context?: RequestContext) => Promise<SearchPage>;
  /** The whole posting's text when the search only gave its start, or null when it can't be had. */
  details: (posting: FoundPosting, credentials: SourceCredentials[S], context?: RequestContext) => Promise<string | null>;
  /** The smallest request that shows the source answers and takes the key. */
  test: (credentials: SourceCredentials[S], context?: RequestContext) => Promise<void>;
};
