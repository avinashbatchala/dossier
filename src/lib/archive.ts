import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { linkKey } from "@/lib/job-search/search";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

// The Archive (E22-7, #393): a posting nobody touched (saved, applied for or
// dismissed) moves there some days after a search last found it, Settings →
// Job search's "Move untouched postings to the archive after". Nothing is
// ever removed automatically: the user moves it back, or removes it, which
// trims it like a dismissed one so no search brings it back.

type Db = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;
/** Rows changed per statement, under SQLite's limit on variables. */
const CHUNK = 500;

async function inChunks(ids: readonly string[], change: (chunk: string[]) => Promise<{ count: number }>): Promise<number> {
  let count = 0;
  for (let start = 0; start < ids.length; start += CHUNK) count += (await change(ids.slice(start, start + CHUNK))).count;
  return count;
}

/**
 * Moves untouched postings to the Archive: found last more than `days` ago
 * (and moved back longer ago than that), not saved, applied for (also from
 * the same link) or dismissed. Being scored or opened doesn't count. Gives
 * how many moved.
 */
export async function archiveUntouched({ now = new Date(), days, db = prisma }: { now?: Date; days?: number; db?: Db } = {}): Promise<number> {
  const cutoff = new Date(now.getTime() - (days ?? (await loadSettings()).archiveAfterDays) * DAY_MS);
  const [candidates, applications] = await Promise.all([
    db.posting.findMany({
      where: {
        archivedAt: null,
        removedAt: null,
        mergedIntoId: null,
        savedAt: null,
        dismissedAt: null,
        applicationId: null,
        lastFoundAt: { lt: cutoff },
        OR: [{ movedBackAt: null }, { movedBackAt: { lt: cutoff } }],
      },
      select: { id: true, url: true },
    }),
    db.application.findMany({ where: { postingUrl: { not: "" } }, select: { postingUrl: true } }),
  ]);
  const applied = new Set(applications.map((application) => linkKey(application.postingUrl)).filter(Boolean));
  const ids = candidates.filter((posting) => !applied.has(linkKey(posting.url))).map((posting) => posting.id);
  return inChunks(ids, (chunk) => db.posting.updateMany({ where: { id: { in: chunk }, archivedAt: null }, data: { archivedAt: now } }));
}

/** "Move back": into Positions again, opened, and the days start over. */
export async function moveBack(postingIds: readonly string[], { now = new Date(), db = prisma }: { now?: Date; db?: Db } = {}): Promise<number> {
  return inChunks(postingIds, (chunk) =>
    db.posting.updateMany({ where: { id: { in: chunk }, archivedAt: { not: null }, removedAt: null }, data: { archivedAt: null, movedBackAt: now, seenAt: now } }),
  );
}

/** "Remove": out of the Archive for good, trimmed to what's needed to know it again, so no search brings it back. Its score stays. */
export async function removeArchived(postingIds: readonly string[], { now = new Date(), db = prisma }: { now?: Date; db?: Db } = {}): Promise<number> {
  return inChunks(postingIds, (chunk) =>
    db.posting.updateMany({ where: { id: { in: chunk }, archivedAt: { not: null }, removedAt: null }, data: { removedAt: now, description: "", complete: false } }),
  );
}

const globalForArchive = globalThis as unknown as { archiveTimer?: ReturnType<typeof setInterval> };

/** Checks every hour, and at start, once per process (dev reloads keep the timer they have). */
export function startArchiveSchedule(): void {
  if (globalForArchive.archiveTimer) return;
  const check = () => void archiveUntouched().catch((error: unknown) => logServerError("archive", error));
  globalForArchive.archiveTimer = setInterval(check, EVERY_MS);
  // Don't keep the process alive just for this.
  globalForArchive.archiveTimer.unref?.();
  check();
}
