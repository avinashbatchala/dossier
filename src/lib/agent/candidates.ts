import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { linkKey, type FoundPosting } from "@/lib/job-search/search";

// The job agent's candidates (E16): postings it found and scored. A dismissed
// one stays, so the posting never comes back, but keeps only what dedupe
// needs.

/** Lower case, letters and digits only, accents dropped: "Café  GmbH" and "cafe gmbh" are the same. */
const normal = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The dedupe key: a hash of the link without tracking parameters, else of
 * company, title and place, so the same job found through another source or
 * in a later run matches. A posting with none of those falls back to its
 * source's id.
 */
export function agentDedupeKey(posting: Pick<FoundPosting, "source" | "externalId" | "url" | "title" | "company" | "place">): string {
  const link = linkKey(posting.url);
  const facts = [posting.company, posting.title, posting.place].map(normal);
  const basis = link ? `link:${link}` : facts.some(Boolean) ? `job:${facts.join("|")}` : `id:${posting.source}:${posting.externalId}`;
  return createHash("sha256").update(basis).digest("hex");
}

/** A posting as a new candidate, with its score. */
export function candidateData(posting: FoundPosting, score: { score: number; reasons: string[]; redFlags: string[] }): Prisma.AgentCandidateCreateInput {
  return {
    source: posting.source,
    externalId: posting.externalId,
    title: posting.title,
    company: posting.company,
    place: posting.place,
    remote: posting.remote,
    salary: posting.salary,
    postedAt: posting.postedAt ? new Date(posting.postedAt) : null,
    url: posting.url,
    via: posting.via,
    description: posting.description,
    complete: posting.complete,
    score: score.score,
    reasons: score.reasons,
    redFlags: score.redFlags,
    dedupeKey: agentDedupeKey(posting),
  };
}

/**
 * What a dismissed candidate gives up (#191): everything but its source, the
 * source's id, its dedupe key, title and company, which say what it was.
 */
export const DISMISSED_TRIM = {
  place: "",
  remote: null,
  salary: "",
  postedAt: null,
  url: "",
  via: "",
  description: "",
  complete: false,
  reasons: [],
  redFlags: [],
  error: null,
  applicationId: null,
} satisfies Prisma.AgentCandidateUncheckedUpdateInput;

/** A JSON list of strings, as reasons and red flags are stored; anything else reads as none. */
export function stringsOf(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
