import "server-only";

import { prisma } from "@/lib/prisma";
import { firstProfileId } from "@/lib/profiles";

import { countRoleUsage, type RoleUsage } from "./role-usage-count";

/**
 * How many of a profile's tailored resumes use each of its roles (E33-2):
 * "Used in 6 of 7 resumes". An application with no profile belongs to the
 * first one, as everywhere (E24-6); agent drafts not approved yet don't count.
 */
export async function loadRoleUsage(profileId: string): Promise<RoleUsage> {
  const first = (await firstProfileId()) === profileId;
  const documents = await prisma.document.findMany({
    where: { kind: "RESUME", application: { OR: [{ profileId }, ...(first ? [{ profileId: null }] : [])], awaitingReview: false } },
    select: { units: true },
  });
  return countRoleUsage(documents);
}
