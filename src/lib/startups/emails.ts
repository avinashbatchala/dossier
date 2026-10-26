import "server-only";

import { getSitePage } from "./http";
import { robotsAllowed } from "./robots";
import { domainOf, emailLabel, emailOnDomain, findEmails, htmlToText, noApplicationsSentence } from "./text";
import { EMAIL_LABELS, type StartupEmail } from "./types";

// The addresses a startup publishes on its own site (#222). The daily refresh
// reads its home, careers, jobs and contact pages for role addresses
// (jobs@, careers@, hello@); people's own addresses are only read when the
// user asks, also from its about and team pages. Only addresses on the
// startup's own domain count, and nothing is guessed. Politely: robots.txt
// first, one page at a time, and a site that refuses (403, 429) is left
// alone. The pages themselves aren't kept.

const ROLE_PAGES = ["", "/careers", "/jobs", "/contact"];
const PEOPLE_PAGES = [...ROLE_PAGES, "/about", "/team"];
const PAGE_TIMEOUT_MS = 8_000;

/** Application addresses first, then the founders', general ones, and people's own. */
export function rankEmails(emails: readonly StartupEmail[]): StartupEmail[] {
  const seen = new Set<string>();
  return emails
    .filter((entry) => !seen.has(entry.email) && Boolean(seen.add(entry.email)))
    .sort((a, b) => EMAIL_LABELS.indexOf(a.label) - EMAIL_LABELS.indexOf(b.label));
}

/** The addresses on one page that belong to `domain`; people's own only when `people` is set. */
export function addressesOnPage(html: string, pageUrl: string, domain: string, { people, now }: { people: boolean; now: Date }): StartupEmail[] {
  const mailto = [...html.matchAll(/href\s*=\s*["']mailto:([^"'?\s>]+)/gi)].map(([, address]) => {
    try {
      return decodeURIComponent(address);
    } catch {
      return address;
    }
  });
  return [...new Set([...findEmails(mailto.join(" ")), ...findEmails(htmlToText(html))])]
    .filter((email) => emailOnDomain(email, domain))
    .map((email) => ({ email, label: emailLabel(email), from: pageUrl, onRequest: emailLabel(email) === "Person", foundAt: now.toISOString() }))
    .filter((entry) => people || !entry.onRequest);
}

export type SiteLookup = {
  emails: StartupEmail[];
  /** Where the site says it takes no unsolicited applications, as "“…” (acme.com/careers)"; "" when it doesn't. */
  noApplicationsFrom: string;
  /** The site refused (403, 429): it's left alone until the next time. */
  refused: boolean;
};

/** Reads a startup's own pages for the addresses it publishes. */
export async function lookUpSite(website: string, { people = false, now = new Date() }: { people?: boolean; now?: Date } = {}): Promise<SiteLookup> {
  const domain = domainOf(website);
  if (!domain) return { emails: [], noApplicationsFrom: "", refused: false };
  const origin = new URL(website).origin;
  const found: StartupEmail[] = [];
  let noApplicationsFrom = "";
  for (const path of people ? PEOPLE_PAGES : ROLE_PAGES) {
    const url = `${origin}${path || "/"}`;
    if (!(await robotsAllowed(url))) continue;
    const page = await getSitePage(url, { timeoutMs: PAGE_TIMEOUT_MS });
    if (!page.ok) {
      if (page.status === 403 || page.status === 429) return { emails: rankEmails(found), noApplicationsFrom, refused: true };
      continue;
    }
    // A page that moved to another site isn't the startup's.
    const landed = domainOf(page.url);
    if (landed !== domain && !landed.endsWith(`.${domain}`)) continue;
    found.push(...addressesOnPage(page.html, page.url, domain, { people, now }));
    if (!noApplicationsFrom) {
      const sentence = noApplicationsSentence(htmlToText(page.html));
      if (sentence) noApplicationsFrom = `“${sentence}” (${page.url.replace(/^https?:\/\/(www\.)?/, "")})`;
    }
  }
  return { emails: rankEmails(found).slice(0, 8), noApplicationsFrom, refused: false };
}
