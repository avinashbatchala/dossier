import { ApplicationStatus } from "@/generated/prisma/enums";
import { emailAddresses } from "@/lib/application-email";
import { isInProgress } from "@/lib/status";

import { domainOf, FREEMAIL } from "./mime";

// Which application a mail is about (E15-3), from what's in the mail and the
// applications. Pure, so it's tested without Gmail. In order: the Gmail
// thread an application was sent in; the company's own mail domain, as the
// posting or the email's recipient gives it; then the company's name in the
// sender or subject, for mail from applicant tracking systems.

export type MatchableApplication = {
  id: string;
  company: string;
  status: ApplicationStatus;
  postingText: string;
  /** The application email's recipient line. */
  emailTo: string;
  updatedAt: Date;
};

export type MatchableMail = {
  threadId: string;
  fromName: string;
  fromAddress: string;
  subject: string;
};

export type MailMatch = { applicationId: string; by: "thread" | "domain" | "company" } | null;

/** "jobs.northwind.example" → "northwind.example": the part a company owns. */
export function baseDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  // co.uk, com.au and the like keep three labels.
  const keep = parts.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

/** The company domains an application gives: from the posting's and the email's addresses, without free mail. */
export function companyDomains(application: Pick<MatchableApplication, "postingText" | "emailTo">): Set<string> {
  const domains = [...emailAddresses(application.postingText), ...emailAddresses(application.emailTo)]
    .map((address) => baseDomain(domainOf(address)))
    .filter((domain) => domain && !FREEMAIL.has(domain));
  return new Set(domains);
}

/** The words of a text, lowercase, without legal forms. */
function companyWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\b(gmbh|ag|se|inc|ltd|llc|bv|b\.v\.|plc|co|corp|corporation|limited|group|the)\b\.?/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A company name as a word to look for: lowercase, without legal forms. */
export function companyKey(company: string): string {
  return companyWords(company).join("");
}

/**
 * Whether the company's words appear side by side in `haystack`, or written
 * as one word ("NorthwindLogistics", northwindlogistics.com). Whole words
 * only, so "Vita" isn't found in "invitation".
 */
function mentions(haystack: readonly string[], company: readonly string[]): boolean {
  if (haystack.includes(company.join(""))) return true;
  return haystack.some((_, start) => company.every((word, i) => haystack[start + i] === word));
}

/**
 * The most likely of several candidates: one sent and still in progress,
 * else a draft, most recently changed. A closed one never is (#358): a new
 * mail from that company is about something else, and waits in the Inbox
 * unmatched. A reply in a thread already linked still goes to it.
 */
function best(candidates: MatchableApplication[]): MatchableApplication | null {
  const live = candidates.filter((application) => isInProgress(application.status));
  const sent = live.filter((application) => application.status !== ApplicationStatus.DRAFT);
  const pool = sent.length > 0 ? sent : live;
  return [...pool].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
}

export function matchMail(
  mail: MatchableMail,
  applications: readonly MatchableApplication[],
  /** Gmail thread → application, from mail already linked. */
  threads: ReadonlyMap<string, string>,
): MailMatch {
  const byThread = threads.get(mail.threadId);
  if (byThread && applications.some((application) => application.id === byThread)) return { applicationId: byThread, by: "thread" };

  const domain = baseDomain(domainOf(mail.fromAddress));
  if (domain && !FREEMAIL.has(domain)) {
    const byDomain = best(applications.filter((application) => companyDomains(application).has(domain)));
    if (byDomain) return { applicationId: byDomain.id, by: "domain" };
  }

  // Only applications that were sent: a draft can't have had a reply.
  const sent = applications.filter((application) => application.status !== ApplicationStatus.DRAFT);
  const haystack = companyWords(`${mail.fromName} ${domain} ${mail.subject}`);
  const byCompany = sent.filter((application) => {
    const words = companyWords(application.company);
    return words.join("").length >= 4 && mentions(haystack, words);
  });
  // A name that fits several companies proves nothing.
  const companies = new Set(byCompany.map((application) => companyKey(application.company)));
  if (companies.size === 1) {
    const match = best(byCompany);
    if (match) return { applicationId: match.id, by: "company" };
  }
  return null;
}

const RANK: Record<ApplicationStatus, number> = {
  DRAFT: 0,
  SENT: 1,
  SCREENING: 2,
  INTERVIEW: 3,
  OFFER: 4,
  ACCEPTED: 5,
  REJECTED: 5,
  DECLINED: 5,
};

/**
 * Whether a reply's status is worth suggesting: it moves the application
 * forward, or a rejection closes one still in progress. Never backwards.
 */
export function worthSuggesting(current: ApplicationStatus, suggested: ApplicationStatus | null): boolean {
  if (!suggested || suggested === current) return false;
  if (suggested === ApplicationStatus.REJECTED) return isInProgress(current);
  return isInProgress(current) && RANK[suggested] > RANK[current];
}
