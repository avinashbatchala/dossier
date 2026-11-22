import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { VersionCause } from "@/generated/prisma/enums";
import type { Unit } from "@/lib/application-data";

// Versions of a tailored document (E8-10, APP-13): saved after each AI
// change and before each restore (decided 29 September 2026), so any
// earlier state can be looked at and brought back. Edits by hand live in the
// current version.

/** Versions kept per document; older ones are dropped. */
const MAX_VERSIONS = 50;

export type VersionNote = { cause: VersionCause; detail?: string };

let lastTime = 0;
/** Strictly increasing times: several versions saved in one go still sort in the order they were made. */
function nextTime(): Date {
  lastTime = Math.max(Date.now(), lastTime + 1);
  return new Date(lastTime);
}

/** Saves `units` as a version of the document, keeping the newest MAX_VERSIONS. */
export async function saveVersion(tx: Prisma.TransactionClient, documentId: string, units: Unit[], { cause, detail = "" }: VersionNote): Promise<void> {
  await tx.documentVersion.create({
    data: { documentId, units: units as Prisma.InputJsonValue, cause, detail: detail.trim().slice(0, 200), createdAt: nextTime() },
  });
  const older = await tx.documentVersion.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS,
    select: { id: true },
  });
  if (older.length > 0) await tx.documentVersion.deleteMany({ where: { id: { in: older.map((version) => version.id) } } });
}
