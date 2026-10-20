import "server-only";

import { AGENT_RUNS_KEPT, type AgentRun } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The job agent's runs (E16), kept in Settings rather than as their Job rows,
// which the task-data sweep deletes after "Keep task data for": the limits
// below must hold whatever that is set to.

/** At most this many runs in any 24 hours, scheduled or Run now. */
export const AGENT_MAX_RUNS_PER_DAY = 3;
/** Run now waits this long after the previous run of either kind. */
export const AGENT_MANUAL_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The runs in the 24 hours before `now`, newest first. */
export const runsInPastDay = (runs: readonly AgentRun[], now: Date) =>
  runs.filter((run) => now.getTime() - Date.parse(run.at) < DAY_MS);

/** Why no run may start now, in words, or null when one may. */
export function runLimitProblem(runs: readonly AgentRun[], now: Date, { manual }: { manual: boolean }): string | null {
  const recent = runsInPastDay(runs, now);
  if (recent.length >= AGENT_MAX_RUNS_PER_DAY) {
    const free = new Date(Math.min(...recent.map((run) => Date.parse(run.at))) + DAY_MS);
    return `The agent has run ${AGENT_MAX_RUNS_PER_DAY} times in the past 24 hours, as many as it may. ${waitText(free.getTime() - now.getTime())}`;
  }
  const last = runs[0];
  if (manual && last) {
    const wait = Date.parse(last.at) + AGENT_MANUAL_INTERVAL_MS - now.getTime();
    if (wait > 0) return `The agent ran less than an hour ago. ${waitText(wait)}`;
  }
  return null;
}

/** "Try again in 25 minutes." */
function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  const hours = Math.ceil(minutes / 60);
  return `Try again in ${hours} ${hours === 1 ? "hour" : "hours"}.`;
}

/** Records a run as it starts, before it asks the source, so a crash and a retry can't spend the quota twice. */
export async function recordRunStart(now: Date, manual: boolean): Promise<AgentRun> {
  const run: AgentRun = { at: now.toISOString(), manual, message: null };
  const { agentRuns } = await loadSettings();
  await saveSettings({ agentRuns: [run, ...agentRuns].slice(0, AGENT_RUNS_KEPT) });
  return run;
}

/** Notes what a run ended with, for the Agent screen. */
export async function recordRunEnd(run: AgentRun, message: string): Promise<void> {
  const { agentRuns } = await loadSettings();
  await saveSettings({ agentRuns: agentRuns.map((entry) => (entry.at === run.at ? { ...entry, message } : entry)) });
}
