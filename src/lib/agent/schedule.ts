import "server-only";

import { logServerError } from "@/lib/log";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { loadSettings } from "@/lib/settings-data";

import { agentScanJob } from "./jobs";
import { resetStuckAgentCandidates } from "./run";

// The agent's daily run (E16): a plain timer in this process, like the
// nightly backup and the inbox check, so it's only safe with one instance.
// It checks every 15 minutes and starts one run after the chosen hour, if the
// agent is on and hasn't run that day.

const EVERY_MS = 15 * 60 * 1000;

/** The next time the daily run may start. */
export function nextAgentRun(now: Date, hour: number): Date {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

const globalForAgent = globalThis as unknown as { agentTimer?: ReturnType<typeof setInterval> };

async function tick(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.agentEnabled) return;
  const now = new Date();
  if (now.getHours() < settings.agentHour) return;
  if (settings.agentLastRunAt) {
    const last = new Date(settings.agentLastRunAt);
    if (!Number.isNaN(last.getTime()) && last.toDateString() === now.toDateString()) return;
  }
  // A run already queued or running is the day's run.
  const [unfinished] = await findUnfinishedJobs("agent");
  if (unfinished) return;
  await startJob(agentScanJob, { manual: false }, { key: "agent" });
}

/** Starts the timer, once per process (dev reloads keep the one they have). */
export function startAgentSchedule(): void {
  if (globalForAgent.agentTimer) return;
  void resetStuckAgentCandidates().catch((error: unknown) => logServerError("agent recovery", error));
  const run = () => void tick().catch((error: unknown) => logServerError("agent schedule", error));
  globalForAgent.agentTimer = setInterval(run, EVERY_MS);
  // Don't keep the process alive just for this.
  globalForAgent.agentTimer.unref?.();
  run();
}
