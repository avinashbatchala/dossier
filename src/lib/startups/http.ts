import "server-only";

import { lookup as dnsLookup } from "node:dns";

import { env } from "@/lib/env";
import { fetchHtml, type FetchedPage } from "@/lib/posting-fetch";
import { appVersion } from "@/lib/version";

// Requests for Startups (#222). Everything goes out under one user agent that
// says what it is and links to the page explaining it, so a site can tell
// Dossier apart and opt out in robots.txt ("User-agent: Dossier"). In the
// end-to-end tests every request goes to the fake server instead
// (DOSSIER_JOBS_TEST_BASE_URL/startups/<host>/<path>).

export const STARTUPS_INFO_URL = "https://github.com/AienTech/dossier/blob/main/PRIVACY.md#startups";
export const STARTUPS_USER_AGENT = `Mozilla/5.0 (compatible; Dossier/${appVersion}; +${STARTUPS_INFO_URL})`;
/** The product token robots.txt rules name. */
export const ROBOTS_TOKEN = "dossier";

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;

export class SourceError extends Error {
  override name = "SourceError";
}

/** Where a request really goes: the address itself, or the fake server's copy of it in the end-to-end tests. */
export function testAddress(url: string, base = env.DOSSIER_JOBS_TEST_BASE_URL): string {
  if (!base) return url;
  const { host, pathname, search } = new URL(url);
  return `${base.replace(/\/+$/, "")}/startups/${host}${pathname}${search}`;
}

/** GETs a source's address as text, or throws a SourceError saying why. */
export async function getText(url: string, { signal }: { signal?: AbortSignal } = {}): Promise<string> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(testAddress(url), {
      headers: { "user-agent": STARTUPS_USER_AGENT, accept: "application/json, text/html;q=0.8, */*;q=0.5" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch {
    if (signal?.aborted) throw new SourceError("was stopped");
    throw new SourceError(timeout.aborted ? "took too long to answer" : "couldn't be reached");
  }
  if (!response.ok) throw new SourceError(`answered with an error (${response.status})`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new SourceError("sent too much");
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new SourceError("sent too much");
  return text;
}

export async function getJson(url: string, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  const text = await getText(url, options);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceError("didn't answer with JSON");
  }
}

/**
 * A page of a startup's own site, with the posting fetcher's guards (public
 * addresses only, time and size limits). `url` in the answer is where it
 * ended up after redirects, as the real address even in the tests.
 */
export async function getSitePage(url: string, { timeoutMs }: { timeoutMs?: number } = {}): Promise<FetchedPage> {
  const base = env.DOSSIER_JOBS_TEST_BASE_URL;
  if (!base) return fetchHtml(url, { timeoutMs, userAgent: STARTUPS_USER_AGENT });
  const page = await fetchHtml(testAddress(url, base), { timeoutMs, userAgent: STARTUPS_USER_AGENT, lookup: dnsLookup });
  if (!page.ok) return page;
  const prefix = `${base.replace(/\/+$/, "")}/startups/`;
  return { ...page, url: page.url.startsWith(prefix) ? `https://${page.url.slice(prefix.length)}` : page.url };
}
