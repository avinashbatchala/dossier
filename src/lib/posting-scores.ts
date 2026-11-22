import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { breakdownOf, type PostingFit } from "@/lib/fit";
import type { FoundPosting } from "@/lib/job-search/search";
import { byBestFit, coverageOf } from "@/lib/posting-coverage";
import { prisma } from "@/lib/prisma";

// Scores kept per posting and profile (#208, E25-5): from Score in Positions, or the job agent.

/** Keeps a posting's score, replacing an older one. */
export async function saveScore(posting: Pick<FoundPosting, "source" | "externalId">, fit: PostingFit, scoredWith: string, profileId: string): Promise<void> {
  const where = { source_externalId_profileId: { source: posting.source, externalId: posting.externalId, profileId } };
  // A score without a breakdown clears the one before.
  const data = { score: fit.score, reasons: fit.reasons, redFlags: fit.redFlags, breakdown: fit.breakdown ?? Prisma.DbNull, scoredWith };
  await prisma.postingScore.upsert({ where, create: { source: posting.source, externalId: posting.externalId, profileId, ...data }, update: data });
}

/**
 * The profile a posting fits best (E32-2): the best coverage of its scores,
 * the first profile on a tie; null when it wasn't scored.
 */
export async function bestProfileFor(posting: Pick<FoundPosting, "source" | "externalId">): Promise<string | null> {
  const rows = await prisma.postingScore.findMany({
    where: { source: posting.source, externalId: posting.externalId },
    orderBy: [{ profile: { sort: "asc" } }, { profileId: "asc" }],
    select: { profileId: true, breakdown: true },
  });
  return rows.map((row) => ({ id: row.profileId, coverage: coverageOf({ breakdown: breakdownOf(row.breakdown) }), at: 0 })).sort(byBestFit)[0]?.id ?? null;
}
