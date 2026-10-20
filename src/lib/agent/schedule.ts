import "server-only";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { addDays, dayOf } from "@/lib/calendar-view";
import { zonedTime } from "@/lib/google/slots";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import type { AgentRun } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { AGENT_JOB_KEY, agentScanJob } from "./jobs";

// The job agent's daily run (E16-4): a timer in this process, like the
// nightly backups and the inbox check, so it's only right with one instance.
// Every 15 minutes it starts the day's run once the chosen hour has come, in
// the user's time zone, not the server's (usually UTC in Docker).

const EVERY_MS = 15 * 60 * 1000;

/** The moment the run is due on `day`, at `hour` in `timeZone`. */
const dueOn = (day: string, hour: number, timeZone: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return zonedTime(year, month, date, hour, 0, timeZone);
};

/** Whether a run, of either kind, happened on `now`'s day in `timeZone`. */
const ranToday = (runs: readonly AgentRun[], now: Date, timeZone: string) =>
  runs.some((run) => dayOf(new Date(run.at), timeZone) === dayOf(now, timeZone));

/** Whether the day's run should start now: the hour has come, and nothing ran today. */
export function scheduledRunDue(now: Date, hour: number, timeZone: string, runs: readonly AgentRun[]): boolean {
  return now >= dueOn(dayOf(now, timeZone), hour, timeZone) && !ranToday(runs, now, timeZone);
}

/** When the next scheduled run starts: today's, if it's still to come, else tomorrow's. */
export function nextAgentRun(now: Date, hour: number, timeZone: string, runs: readonly AgentRun[]): Date {
  const today = dayOf(now, timeZone);
  if (!ranToday(runs, now, timeZone)) {
    const due = dueOn(today, hour, timeZone);
    // Overdue: the next check starts it.
    return due > now ? due : new Date(Math.ceil(now.getTime() / EVERY_MS) * EVERY_MS);
  }
  return dueOn(addDays(today, 1), hour, timeZone);
}

/** Starts the day's run when it's due and none is queued or running. */
export async function startDueRun(now = new Date()): Promise<string | null> {
  const settings = await loadSettings();
  if (!settings.agentEnabled) return null;
  if (!scheduledRunDue(now, settings.agentHour, await lastKnownTimeZone(), settings.agentRuns)) return null;
  if ((await findUnfinishedJobs(AGENT_JOB_KEY)).length > 0) return null;
  return startJob(agentScanJob, { manual: false }, { key: AGENT_JOB_KEY });
}

/** After a restart, a candidate left DRAFTING has no job to finish it. */
export async function resetInterruptedDrafts(): Promise<number> {
  const { count } = await prisma.agentCandidate.updateMany({
    where: { status: AgentCandidateStatus.DRAFTING },
    data: { status: AgentCandidateStatus.SCORED, error: "Drafting was interrupted. Try again." },
  });
  return count;
}

const globalForAgent = globalThis as unknown as { agentTimer?: ReturnType<typeof setInterval> };

/** Starts the timer, once per process (dev reloads keep the one they have). */
export function startAgentSchedule(): void {
  if (globalForAgent.agentTimer) return;
  void resetInterruptedDrafts().catch((error: unknown) => logServerError("job agent", error));
  const check = () => void startDueRun().catch((error: unknown) => logServerError("job agent schedule", error));
  globalForAgent.agentTimer = setInterval(check, EVERY_MS);
  // Don't keep the process alive just for this.
  globalForAgent.agentTimer.unref?.();
  check();
}
