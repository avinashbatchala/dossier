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

/** A company name as a word to look for: lowercase, without legal forms. */
export function companyKey(company: string): string {
  return company
    .toLowerCase()
    .replace(/\b(gmbh|ag|se|inc|ltd|llc|bv|b\.v\.|plc|co|corp|corporation|limited|group|the)\b\.?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** The most likely of several candidates: one still in progress, most recently changed. */
function best(candidates: MatchableApplication[]): MatchableApplication | null {
  if (candidates.length === 0) return null;
  const open = candidates.filter((application) => isInProgress(application.status) && application.status !== ApplicationStatus.DRAFT);
  const pool = open.length > 0 ? open : candidates;
  return [...pool].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
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
  const haystack = companyKey(`${mail.fromName} ${domain} ${mail.subject}`);
  const byCompany = sent.filter((application) => {
    const key = companyKey(application.company);
    return key.length >= 4 && haystack.includes(key);
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
