import "server-only";

import { findUnfinishedJobs } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import type { SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { startStartupsRefresh, STARTUPS_JOB_KEY } from "./refresh";

// Startups' daily refresh (#222): a timer in this process, like the job
// agent's. Nothing is fetched until the user presses Refresh once, and the
// daily refresh stops when the screen hasn't been opened for two weeks, so
// an install nobody uses Startups on asks no one anything.

const EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Refreshes keep going while the screen was opened within this long. */
const IN_USE_MS = 14 * DAY_MS;
/** A little under a day, so the hourly check doesn't drift later each day. */
const AGE_MS = 22 * 60 * 60 * 1000;

/** Whether the daily refresh is due: it ran before, the screen is in use, and the last one is old. */
export function startupsRefreshDue(settings: Pick<SettingsData, "startupsViewedAt" | "startupsLastRefresh">, now: Date): boolean {
  const { startupsViewedAt: viewed, startupsLastRefresh: last } = settings;
  if (!viewed || !last) return false;
  return now.getTime() - Date.parse(viewed) < IN_USE_MS && now.getTime() - Date.parse(last.at) >= AGE_MS;
}

/** Starts the day's refresh when it's due and none is under way. */
export async function startDueStartupsRefresh(now = new Date()): Promise<string | null> {
  if (!startupsRefreshDue(await loadSettings(), now)) return null;
  if ((await findUnfinishedJobs(STARTUPS_JOB_KEY)).length > 0) return null;
  return startStartupsRefresh();
}

const globalForStartups = globalThis as unknown as { startupsTimer?: ReturnType<typeof setInterval> };

/** Starts the timer, once per process (dev reloads keep the one they have). */
export function startStartupsSchedule(): void {
  if (globalForStartups.startupsTimer) return;
  const check = () => void startDueStartupsRefresh().catch((error: unknown) => logServerError("startups schedule", error));
  globalForStartups.startupsTimer = setInterval(check, EVERY_MS);
  // Don't keep the process alive just for this.
  globalForStartups.startupsTimer.unref?.();
  check();
}
