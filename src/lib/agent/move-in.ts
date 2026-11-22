import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { companyKey } from "@/lib/dedupe";
import { EMPTY_QUERY, postingKey } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { firstProfileId } from "@/lib/profiles";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Puts what the job agent found before E22-8 (#394) into the positions
 * library, once: each candidate as a posting (seen, since the Agent screen
 * showed it; dismissed when it was), with its score, found by the agent
 * searches that found it, under their names then. Postings already in the
 * library keep what they have and get the agent's finds. Safe to run again:
 * a candidate whose posting the agent found already is left out. At start,
 * and after an import. Gives how many it moved.
 */
export async function moveAgentFinds(db: Db = prisma): Promise<number> {
  const [candidates, attributed] = await Promise.all([
    db.agentCandidate.findMany({ include: { searches: { include: { search: { select: { query: true } } } } }, orderBy: { createdAt: "asc" } }),
    db.posting.findMany({ where: { finds: { some: { search: { agentSearchName: { not: null } } } } }, select: { source: true, externalId: true } }),
  ]);
  const done = new Set(attributed.map(postingKey));
  const waiting = candidates.filter((candidate) => !done.has(postingKey(candidate)));
  if (waiting.length === 0) return 0;

  // One search for each agent search the candidates name, as it was called; "" for those from before agent searches had names.
  const searches = new Map<string, string>();
  const searchFor = async (agentSearchId: string | null, name: string, query: Prisma.JsonValue | null, at: Date) => {
    const key = `${agentSearchId ?? ""}\u0000${name}`;
    const known = searches.get(key);
    if (known) return known;
    const created = await db.postingSearch.create({
      data: { query: (query ?? { ...EMPTY_QUERY, keywords: name }) as Prisma.InputJsonValue, portals: [], found: 0, agentSearchId, agentSearchName: name, createdAt: at },
      select: { id: true },
    });
    searches.set(key, created.id);
    return created.id;
  };

  for (const candidate of waiting) {
    const where = { source_externalId: { source: candidate.source, externalId: candidate.externalId } };
    const dismissed = candidate.status === AgentCandidateStatus.DISMISSED;
    const existing = await db.posting.findUnique({ where, select: { id: true, mergedIntoId: true } });
    const postingId =
      existing?.mergedIntoId ??
      existing?.id ??
      (
        await db.posting.create({
          data: {
            source: candidate.source,
            externalId: candidate.externalId,
            title: candidate.title,
            company: candidate.company,
            place: candidate.place,
            remote: candidate.remote,
            salary: candidate.salary,
            postedAt: candidate.postedAt,
            url: candidate.url,
            via: candidate.via,
            description: dismissed ? "" : candidate.description,
            complete: dismissed ? false : candidate.complete,
            matchCompany: companyKey(candidate.company),
            lastFoundAt: candidate.createdAt,
            seenAt: candidate.createdAt,
            dismissedAt: dismissed ? candidate.updatedAt : null,
          },
          select: { id: true },
        })
      ).id;
    // Scored before scores were kept for Positions (#208): the score shows there too.
    if (!dismissed) {
      // The first profile's, as every score before E25-5 was.
      const score = { source: candidate.source, externalId: candidate.externalId, profileId: await firstProfileId(db) };
      if (!(await db.postingScore.findUnique({ where: { source_externalId_profileId: score } }))) {
        await db.postingScore.create({ data: { ...score, score: candidate.score, reasons: candidate.reasons ?? [], redFlags: candidate.redFlags ?? [], scoredWith: "job agent" } });
      }
    }
    const names = candidate.searches.length > 0 ? candidate.searches : [{ searchId: null, searchName: "", search: null }];
    for (const name of names) {
      const searchId = await searchFor(name.searchId, name.searchName, name.search?.query ?? null, candidate.createdAt);
      await db.postingFind.upsert({
        where: { postingId_searchId: { postingId, searchId } },
        create: { postingId, searchId, portal: candidate.source, foundAt: candidate.createdAt },
        update: {},
      });
    }
  }
  for (const searchId of searches.values()) {
    await db.postingSearch.update({ where: { id: searchId }, data: { found: await db.postingFind.count({ where: { searchId } }) } });
  }
  return waiting.length;
}
