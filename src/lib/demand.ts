import "server-only";

import { addableSkill, extractedSchema, matchSchema } from "@/lib/application-data";
import { breakdownOf } from "@/lib/fit";
import { prisma } from "@/lib/prisma";
import { firstProfileId, loadProfileSettings } from "@/lib/profiles";

import { countDemand, skillKey, type Ask, type Demand, type DemandSource } from "./demand-count";

/** How far back "What employers ask for" looks (E33-3). */
const DEMAND_DAYS = 90;
const DAY = 86_400_000;

/** What employers ask for, the skills this profile said it doesn't have (E33-3), and "Not here" on its roles' gap prompts (E33-4). */
export type DemandData = Demand & { hidden: string[]; notHere: string[] };

/**
 * What the postings a profile was scored against ask for (E33-3, decided 17
 * November): saved and applied-for postings scored for it in the last 90
 * days, and its applications from then. Each skill counts once a posting,
 * grouped by its normalised name. No AI.
 *
 * Hidden: "I don't have this" here, or on one of its applications' gaps.
 */
export async function loadDemand(profileId: string, now = new Date()): Promise<DemandData> {
  const since = new Date(now.getTime() - DEMAND_DAYS * DAY);
  const first = (await firstProfileId()) === profileId;
  const [postings, applications, settings] = await Promise.all([
    prisma.posting.findMany({
      where: { OR: [{ savedAt: { not: null } }, { applicationId: { not: null } }] },
      select: { source: true, externalId: true, company: true, applicationId: true },
    }),
    prisma.application.findMany({
      // An application with no profile belongs to the first one (E24-6); an agent draft isn't applied for yet.
      where: { awaitingReview: false, createdAt: { gte: since }, OR: [{ profileId }, ...(first ? [{ profileId: null }] : [])] },
      select: { id: true, company: true, match: true, extracted: true, createdAt: true, knownGaps: { select: { requirement: true } } },
    }),
    loadProfileSettings(profileId),
  ]);
  const scores =
    postings.length === 0
      ? []
      : await prisma.postingScore.findMany({
          where: { profileId, updatedAt: { gte: since }, OR: postings.map(({ source, externalId }) => ({ source, externalId })) },
          select: { source: true, externalId: true, breakdown: true, updatedAt: true },
        });

  const postingOf = new Map(postings.map((posting) => [`${posting.source}:${posting.externalId}`, posting]));
  const sources: (DemandSource & { at: Date })[] = [];
  const counted = new Set<string>();
  for (const score of scores) {
    const posting = postingOf.get(`${score.source}:${score.externalId}`);
    const breakdown = breakdownOf(score.breakdown);
    if (!posting || !breakdown) continue;
    const asks = breakdown.requirements.flatMap((requirement): Ask[] => (requirement.skill ? [{ skill: requirement.skill, covered: requirement.covered }] : []));
    sources.push({ company: posting.company, asks, at: score.updatedAt });
    if (posting.applicationId) counted.add(posting.applicationId);
  }

  const hidden = new Set(settings.gapsDismissed);
  for (const application of applications) {
    const match = matchSchema.safeParse(application.match);
    const extracted = extractedSchema.safeParse(application.extracted);
    const requirements = extracted.success ? extracted.data.requirements : [];
    const items = match.success ? match.data.items : [];
    // "I don't have this" on one of its gaps (E30-5) hides that skill here too.
    const known = new Set(application.knownGaps.map((gap) => gap.requirement));
    items.forEach((item, index) => {
      const skill = item.skill ?? addableSkill(item, requirements[index]);
      if (skill && known.has(item.requirement)) hidden.add(skillKey(skill));
    });
    // Its posting's score already counted it.
    if (counted.has(application.id)) continue;
    const asks: Ask[] = [
      ...items.flatMap((item, index): Ask[] => {
        const skill = item.skill ?? addableSkill(item, requirements[index]);
        return skill ? [{ skill, covered: item.result !== "gap" }] : [];
      }),
      // What the posting asked for, where the match doesn't say: covered or not is then the profile's to tell.
      ...requirements.flatMap((requirement): Ask[] => (requirement.kind === "skill" && requirement.skill ? [{ skill: requirement.skill, covered: null }] : [])),
    ];
    sources.push({ company: application.company, asks, at: application.createdAt });
  }

  sources.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { ...countDemand(sources), hidden: [...hidden], notHere: settings.gapsNotHere };
}
