import "server-only";

import { getSitePage, ROBOTS_TOKEN } from "./http";
import { parseRobots, robotsAllow, type RobotsRules } from "./robots-rules";

// Whether a startup's site lets Dossier read a page (#222), by its
// robots.txt (RFC 9309). A missing file allows everything; a site that
// can't be reached, errs, or refuses the file means "not now", the cautious
// reading. Answers are kept for a day, as the RFC allows.

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;
const cache = new Map<string, { rules: RobotsRules; at: number }>();

async function rulesFor(origin: string): Promise<RobotsRules> {
  const known = cache.get(origin);
  if (known && Date.now() - known.at < DAY_MS) return known.rules;
  const page = await getSitePage(`${origin}/robots.txt`, { timeoutMs: TIMEOUT_MS });
  let rules: RobotsRules;
  if (page.ok) rules = parseRobots(page.html, ROBOTS_TOKEN);
  // Missing (404, 410, …): nothing is off limits. Refused, failing or unreachable: everything is.
  else if (page.status && page.status >= 400 && page.status < 500 && ![401, 403, 429].includes(page.status)) rules = "all";
  else rules = "none";
  if (cache.size > 500) cache.clear();
  cache.set(origin, { rules, at: Date.now() });
  return rules;
}

/** Whether robots.txt lets Dossier fetch `url`. */
export async function robotsAllowed(url: string): Promise<boolean> {
  const { origin, pathname, search } = new URL(url);
  return robotsAllow(await rulesFor(origin), `${pathname}${search}`);
}

/** Forgets what was read, for the tests. */
export function clearRobotsCache(): void {
  cache.clear();
}
