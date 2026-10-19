import "server-only";

import { JobStatus } from "@/generated/prisma/enums";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { removeOldZips } from "./zip-pdfs";

// A finished job is only needed for a while: for a reload to find it again,
// for Undo on its toast, for a resume reading or a New application draft
// still waiting to be used. What it holds (a posting, a resume's text,
// drafts) is either in an application by then or was never used, so it's
// deleted once it's older than "Keep task data for" in Settings → Your data.
// A plain timer in this process, like the nightly backups.

const HOUR_MS = 60 * 60 * 1000;
/** How often the sweep runs. */
const EVERY_MS = 15 * 60 * 1000;

/** Deletes finished jobs older than the retention, and zips nobody downloaded; returns how many jobs went. */
export async function sweepFinishedJobs(now = new Date(), hours?: number): Promise<number> {
  const keep = hours ?? (await loadSettings()).jobRetentionHours;
  const cutoff = new Date(now.getTime() - keep * HOUR_MS);
  const { count } = await prisma.job.deleteMany({
    where: {
      status: { in: [JobStatus.DONE, JobStatus.FAILED] },
      OR: [{ finishedAt: { lt: cutoff } }, { finishedAt: null, updatedAt: { lt: cutoff } }],
    },
  });
  await removeOldZips(now.getTime());
  return count;
}

const globalForSweep = globalThis as unknown as { jobSweepTimer?: ReturnType<typeof setInterval> };

/** Sweeps now and every 15 minutes, once per process (dev reloads keep the timer they have). */
export function startJobSweep(): void {
  if (globalForSweep.jobSweepTimer) return;
  const sweep = () => void sweepFinishedJobs().catch((error: unknown) => logServerError("job sweep", error));
  globalForSweep.jobSweepTimer = setInterval(sweep, EVERY_MS);
  // Don't keep the process alive just for this.
  globalForSweep.jobSweepTimer.unref?.();
  sweep();
}
