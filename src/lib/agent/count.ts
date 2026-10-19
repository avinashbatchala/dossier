import "server-only";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/** The Agent badge: items waiting for a look, not ones already being written. */
export async function countAgentQueue(): Promise<number> {
  return prisma.agentCandidate.count({
    where: { status: { in: [AgentCandidateStatus.SCORED, AgentCandidateStatus.DRAFTED] } },
  });
}
