import "server-only";

import type { Posting, Prisma } from "@/generated/prisma/client";
import { breakdownOf, isOlderScore } from "@/lib/fit";
import { bestFit, linkKey, postingKey, type FoundPosting, type PostingState, type ProfileFit } from "@/lib/job-search/search";
import { stringsOf } from "@/lib/agent/candidates";
import { lockAgentSearches } from "@/lib/agent/searches";
import { prisma } from "@/lib/prisma";

// Postings in the positions library (E22-5): every posting a search found,
// and what the user did with it (E14-5): saved, dismissed, or started an
// application from. Doing any of these counts as having seen it.

export type { PostingState };

type PostingRef = { source: string; externalId: string };

const whereRef = ({ source, externalId }: PostingRef) => ({ source_externalId: { source, externalId } });

function fieldsOf(found: FoundPosting) {
  return {
    title: found.title,
    company: found.company,
    place: found.place,
    remote: found.remote,
    salary: found.salary,
    postedAt: found.postedAt ? new Date(found.postedAt) : null,
    url: found.url,
    via: found.via,
    description: found.description,
    complete: found.complete,
  };
}

/** A stored posting in the shape search results have. */
export function foundFromPosting(posting: Posting): FoundPosting {
  return {
    source: posting.source,
    externalId: posting.externalId,
    title: posting.title,
    company: posting.company,
    place: posting.place,
    remote: posting.remote,
    salary: posting.salary,
    postedAt: posting.postedAt?.toISOString() ?? null,
    url: posting.url,
    via: posting.via,
    description: posting.description,
    complete: posting.complete,
  };
}

/**
 * Stores a posting, or refreshes it from a newer search, with `marks`. A
 * whole description isn't replaced by a snippet; saved and dismissed dates
 * only change when `marks` says so.
 */
export async function storePosting(found: FoundPosting, marks: { savedAt?: Date | null; dismissedAt?: Date | null; seenAt?: Date; archivedAt?: null } = {}): Promise<Posting> {
  return prisma.$transaction(async (tx) => {
    const where = whereRef(found);
    const existing = await tx.posting.findUnique({ where, select: { complete: true } });
    const { description, complete, ...rest } = fieldsOf(found);
    const text = existing?.complete && !complete ? {} : { description, complete };
    return tx.posting.upsert({
      where,
      create: { source: found.source, externalId: found.externalId, ...rest, description, complete, ...marks },
      update: { ...rest, ...text, ...marks },
    });
  });
}

/** Save: into the Saved list, and out of Dismissed and the Archive. */
export const savePosting = (found: FoundPosting) => storePosting(found, { savedAt: new Date(), dismissedAt: null, seenAt: new Date(), archivedAt: null });

/** Dismiss: out of later searches, and out of Saved. Says whether it was saved, for Undo. */
export async function dismissPosting(found: FoundPosting): Promise<{ wasSaved: boolean }> {
  const before = await prisma.posting.findUnique({ where: whereRef(found), select: { savedAt: true } });
  const posting = await storePosting(found, { dismissedAt: new Date(), savedAt: null, seenAt: new Date(), archivedAt: null });
  // Trimmed to what's needed to know it again (E22-5): it never comes back, and its text can be fetched again on Undo.
  await prisma.posting.update({ where: { id: posting.id }, data: { description: "", complete: false } });
  // Out of the job agent's queue too (E22-8): its text kept, so Undo can put it back; its search labels go, as on the Agent screen.
  await prisma.$transaction(async (tx) => {
    // Serialized with the agent's attribution, so a run can't put labels back meanwhile.
    await lockAgentSearches(tx);
    const queued = await tx.agentCandidate.findMany({ where: { source: found.source, externalId: found.externalId, status: "SCORED" }, select: { id: true } });
    if (queued.length === 0) return;
    const ids = queued.map((candidate) => candidate.id);
    await tx.agentCandidate.updateMany({ where: { id: { in: ids } }, data: { status: "DISMISSED" } });
    await tx.agentCandidateSearch.deleteMany({ where: { candidateId: { in: ids } } });
  });
  return { wasSaved: Boolean(before?.savedAt) };
}

/**
 * Takes a posting out of Saved, or back from Dismissed (`saved` puts it back
 * in Saved too, to undo a Dismiss). One left with no reason to be kept goes.
 */
export async function unmarkPosting(ref: PostingRef, mark: "saved" | "dismissed", { saved = false }: { saved?: boolean } = {}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const where = whereRef(ref);
    if (!(await tx.posting.findUnique({ where, select: { id: true } }))) return;
    // It stays in the library either way: a search found it.
    await tx.posting.update({
      where,
      data: mark === "saved" ? { savedAt: null } : { dismissedAt: null, ...(saved ? { savedAt: new Date() } : {}) },
    });
    // Back in the job agent's queue when it was dismissed here, not on the Agent screen, which trims it (E22-8).
    if (mark === "dismissed") await tx.agentCandidate.updateMany({ where: { source: ref.source, externalId: ref.externalId, status: "DISMISSED", description: { not: "" } }, data: { status: "SCORED" } });
  });
}

/** Where a posting stands with the job agent, from its candidate row. */
const agentOf = (candidate: { id: string; status: string; applicationId: string | null } | undefined): PostingState["agent"] =>
  candidate ? { candidateId: candidate.id, status: candidate.status as NonNullable<PostingState["agent"]>["status"], applicationId: candidate.applicationId } : null;

/**
 * Where each of a page of results stands, by postingKey(). Applied also
 * counts applications made from the same link before Find jobs, ignoring
 * tracking parameters.
 */
export async function postingStates(found: readonly (PostingRef & { url: string })[], db: Prisma.TransactionClient = prisma): Promise<Map<string, PostingState>> {
  if (found.length === 0) return new Map();
  const refs = found.map(({ source, externalId }) => ({ source, externalId }));
  const [stored, applications, scores, candidates] = await Promise.all([
    db.posting.findMany({
      where: { OR: found.map(({ source, externalId }) => ({ source, externalId })) },
      select: {
        id: true,
        source: true,
        externalId: true,
        savedAt: true,
        dismissedAt: true,
        applicationId: true,
        seenAt: true,
        archivedAt: true,
        lastFoundAt: true,
        merged: { select: { source: true, url: true }, orderBy: { createdAt: "asc" } },
        // The job agent's searches that found it (E22-8).
        finds: { where: { search: { agentSearchName: { not: null } } }, select: { search: { select: { agentSearchName: true } } }, orderBy: { foundAt: "asc" } },
      },
    }),
    // An agent draft waiting for review isn't applied for yet (#195).
    db.application.findMany({ where: { postingUrl: { not: "" }, awaitingReview: false }, select: { id: true, postingUrl: true }, orderBy: { createdAt: "asc" } }),
    db.postingScore.findMany({ where: { OR: refs }, include: { profile: { select: { name: true, sort: true, createdAt: true } } } }),
    // A posting the agent only skipped (E32-5) isn't one of its finds.
    db.agentCandidate.findMany({ where: { OR: refs, skipReason: null }, select: { id: true, source: true, externalId: true, status: true, applicationId: true } }),
  ]);
  const candidateOf = new Map(candidates.map((candidate) => [postingKey(candidate), candidate]));
  // Each posting's scores, a profile's name only when there are several (E25-5).
  const several = new Set(scores.map((row) => row.profileId)).size > 1 || (scores.length > 0 && (await db.profile.count()) > 1);
  const scoresOf = new Map<string, ProfileFit[]>();
  for (const row of scores.toSorted((a, b) => a.profile.sort - b.profile.sort || a.profile.createdAt.getTime() - b.profile.createdAt.getTime())) {
    const fit: ProfileFit = {
      profileId: row.profileId,
      profileName: several ? row.profile.name : "",
      score: row.score,
      reasons: stringsOf(row.reasons),
      redFlags: stringsOf(row.redFlags),
      breakdown: breakdownOf(row.breakdown),
      older: isOlderScore(row.scoredWith),
    };
    scoresOf.set(postingKey(row), [...(scoresOf.get(postingKey(row)) ?? []), fit]);
  }
  const byKey = new Map(stored.map((posting) => [postingKey(posting), posting]));
  const byLink = new Map<string, string>();
  for (const application of applications) {
    const key = linkKey(application.postingUrl);
    if (key && !byLink.has(key)) byLink.set(key, application.id);
  }
  return new Map(
    found.map((posting) => {
      const row = byKey.get(postingKey(posting));
      const link = linkKey(posting.url);
      return [
        postingKey(posting),
        {
          postingId: row?.id ?? null,
          new: Boolean(row && !row.seenAt && !row.dismissedAt),
          saved: Boolean(row?.savedAt),
          dismissed: Boolean(row?.dismissedAt),
          applicationId: row?.applicationId ?? ((link && byLink.get(link)) || null),
          score: bestFit(scoresOf.get(postingKey(posting)) ?? []),
          scores: scoresOf.get(postingKey(posting)) ?? [],
          foundOn: [{ portal: posting.source, url: posting.url }, ...(row?.merged ?? []).map((other) => ({ portal: other.source, url: other.url }))].filter(
            (entry, index, all) => all.findIndex((first) => first.portal === entry.portal) === index,
          ),
          archived: Boolean(row?.archivedAt),
          stillListedAt: row?.archivedAt && row.lastFoundAt > row.archivedAt ? row.lastFoundAt.toISOString() : null,
          agentSearches: [...new Set((row?.finds ?? []).map((find) => find.search.agentSearchName ?? ""))],
          agent: agentOf(candidateOf.get(postingKey(posting))),
        },
      ];
    }),
  );
}
