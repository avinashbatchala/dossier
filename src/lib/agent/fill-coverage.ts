import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { breakdownOf } from "@/lib/fit";
import { betterCoverage, coverageOf, NO_COVERAGE } from "@/lib/posting-coverage";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Gives candidates kept before coverage (E32-2) theirs: the best of their
 * postings' kept scores. One whose scores have no breakdown keeps 0 of 0.
 * Safe to run again; at start, and after an import.
 */
export async function fillCandidateCoverage(db: Db = prisma): Promise<number> {
  const candidates = await db.agentCandidate.findMany({ where: { requirements: 0 }, select: { id: true, source: true, externalId: true } });
  let filled = 0;
  for (let start = 0; start < candidates.length; start += 500) {
    const chunk = candidates.slice(start, start + 500);
    const scores = await db.postingScore.findMany({ where: { externalId: { in: chunk.map((candidate) => candidate.externalId) } }, select: { source: true, externalId: true, breakdown: true } });
    for (const candidate of chunk) {
      const coverage = scores
        .filter((score) => score.source === candidate.source && score.externalId === candidate.externalId)
        .map((score) => coverageOf({ breakdown: breakdownOf(score.breakdown) }))
        .reduce(betterCoverage, NO_COVERAGE);
      if (coverage.total === 0) continue;
      await db.agentCandidate.update({ where: { id: candidate.id }, data: { covered: coverage.hit, requirements: coverage.total, mustMissing: coverage.mustMissing } });
      filled += 1;
    }
  }
  return filled;
}
