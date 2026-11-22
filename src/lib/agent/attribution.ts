import "server-only";

import { postingKey, type FoundPosting } from "@/lib/job-search/search";
import { postingStates } from "@/lib/postings";
import { prisma } from "@/lib/prisma";

import { agentDedupeKey } from "./candidates";
import { lockAgentSearches } from "./searches";

/**
 * Link a search's results only to candidates already kept (newly scored or
 * seen before). Call after scoring too, so overlapping searches share one
 * candidate. No raw results or dismissed/Find jobs exclusions are recorded.
 * Repeating this leaves the first name snapshot untouched.
 * Candidate dismissal shares the write lock and removes these labels.
 * Later Find jobs saves do not erase historical attribution.
 */
export async function attributeAgentCandidates(search: { id: string; name: string }, postings: readonly FoundPosting[]): Promise<void> {
  if (postings.length === 0) return;
  await prisma.$transaction(async (tx) => {
    // Always take the shared advisory lock before reads/row locks, matching
    // search edits, import and wipe. No source calls happen under this lock.
    await lockAgentSearches(tx);
    if (!await tx.agentSearch.findUnique({ where: { id: search.id } })) return;
    const states = await postingStates(postings, tx);
    const eligible = postings.filter((posting) => {
      const state = states.get(postingKey(posting));
      return !state?.saved && !state?.dismissed && !state?.applicationId;
    });
    if (eligible.length === 0) return;
    const candidates = await tx.agentCandidate.findMany({
      where: {
        status: { not: "DISMISSED" },
        OR: [...eligible.map(({ source, externalId }) => ({ source, externalId })), { dedupeKey: { in: eligible.map(agentDedupeKey) } }],
      },
      select: { id: true, source: true, externalId: true, url: true },
    });
    // A source alias may match a candidate whose original posting was kept
    // or dismissed in Find jobs. Check that reference too, not just the alias.
    const candidateStates = await postingStates(candidates, tx);
    const linked = candidates.filter((candidate) => {
      const state = candidateStates.get(postingKey(candidate));
      return !state?.saved && !state?.dismissed && !state?.applicationId;
    });
    // Ones linked already keep their first name: no skipDuplicates, which SQLite
    // doesn't have, but the lock above means nothing adds them meanwhile.
    const known = new Set(
      (await tx.agentCandidateSearch.findMany({ where: { searchId: search.id, candidateId: { in: linked.map(({ id }) => id) } }, select: { candidateId: true } })).map(
        ({ candidateId }) => candidateId,
      ),
    );
    await tx.agentCandidateSearch.createMany({
      data: linked.filter(({ id }) => !known.has(id)).map(({ id }) => ({ candidateId: id, searchId: search.id, searchName: search.name })),
    });
  });
}
