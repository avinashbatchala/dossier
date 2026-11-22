import "server-only";

import { lockForTransaction } from "@/lib/db-lock";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/dates";
import { sourceInfo } from "@/lib/job-search/sources";
import { AGENT_MAX_SLOTS_PER_RUN, AGENT_MAX_SOURCE_REQUESTS_PER_DAY } from "./limits";
import { AGENT_RUNS_KEPT, settingsFromRows, type AgentRun, type AgentSearchRun } from "@/lib/settings";

/** Serializes the run ledger's writes (public PR 61). */
const RUNS_LOCK = 621746002;

/**
 * Source-request slots, not runs, counted per portal (E22-8): each portal
 * gets AGENT_MAX_SOURCE_REQUESTS_PER_DAY in a rolling 24 hours, on top of its
 * own quota. Failed requests consume slots too. A slot from before E22-8
 * names no portal, so it counts against every one.
 */
const AGENT_MANUAL_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const requestTimes = (run: AgentRun): string[] =>
  Array.from({ length: run.sourceRequests ?? 1 }, (_, index) => run.sourceRequestAts?.[index] ?? run.at);

/** The slots used within 24 hours of `now` that count against `portal`, oldest first. */
function recentSlots(runs: readonly AgentRun[], now: Date, portal: string): number[] {
  return runs
    .flatMap((run) => requestTimes(run).map((at, index) => ({ at: Date.parse(at), portal: run.sourceRequestPortals?.[index] ?? null })))
    .filter((slot) => slot.at + DAY_MS > now.getTime() && (slot.portal === null || slot.portal === portal))
    .map((slot) => slot.at)
    .toSorted((a, b) => a - b);
}

/** Requests to `portal` in the past 24 hours. */
export const sourceRequestsInPastDay = (runs: readonly AgentRun[], now: Date, portal: string) => recentSlots(runs, now, portal).length;

/** How many slots a run needs on each portal. */
function perPortal(slots: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const portal of slots) counts.set(portal, (counts.get(portal) ?? 0) + 1);
  return counts;
}

export function interruptedRunMessage(run: AgentRun): string {
  const requests = run.sourceRequests ?? 1;
  return `The agent scan was interrupted. All ${requests} reserved source ${requests === 1 ? "request still counts" : "requests still count"} toward the 24-hour limit, including any not sent.`;
}

/** When a portal has room for `requests` more. */
function portalFreeAt(runs: readonly AgentRun[], now: Date, portal: string, requests: number): Date {
  const recent = recentSlots(runs, now, portal);
  let used = recent.length;
  // Expire oldest slots one at a time until the ENTIRE requested batch fits.
  // At exactly timestamp + 24h a slot is free (the rolling window is open
  // at its older boundary), including the last request of a slow prior run.
  for (const at of recent) {
    if (used + requests <= AGENT_MAX_SOURCE_REQUESTS_PER_DAY) break;
    used -= 1;
    if (used + requests <= AGENT_MAX_SOURCE_REQUESTS_PER_DAY) return new Date(at + DAY_MS);
  }
  return now;
}

/** Whole-run admission: wait until every portal has room for all its slots, never run a subset. */
export function nextSourceBudgetAt(runs: readonly AgentRun[], now: Date, slots: readonly string[]): Date {
  let free = now;
  for (const [portal, requests] of perPortal(slots)) {
    const at = portalFreeAt(runs, now, portal, requests);
    if (at > free) free = at;
  }
  return free;
}

/** Call only while owning the session scan lock: null messages can otherwise
 * belong to a live scan. Retain all reservations after a crash, even unused
 * ones, because source dispatch and database writes cannot be one transaction.
 */
export async function reconcileInterruptedRuns(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, RUNS_LOCK);
    const runs = settingsFromRows(await tx.setting.findMany({ where: { key: "agentRuns" } })).agentRuns;
    if (!runs.some((run) => run.message === null)) return;
    for (const run of runs) {
      if (run.message !== null) continue;
      run.message = interruptedRunMessage(run);
    }
    await tx.setting.update({ where: { key: "agentRuns" }, data: { value: JSON.stringify(runs) } });
  });
}

export function runLimitProblem(runs: readonly AgentRun[], now: Date, { manual, slots = [], timeZone = "UTC" }: { manual: boolean; slots?: readonly string[]; timeZone?: string }): string | null {
  const free = nextSourceBudgetAt(runs, now, slots);
  if (free > now) {
    const full = [...perPortal(slots)].filter(([portal, requests]) => portalFreeAt(runs, now, portal, requests) > now);
    const asks = full.map(([portal, requests]) => `${requests} ${requests === 1 ? "request" : "requests"} to ${sourceInfo(portal).name}`).join(" and ");
    return `The agent needs ${asks} this run, but may send each portal only ${AGENT_MAX_SOURCE_REQUESTS_PER_DAY} in 24 hours. Next eligible: ${formatDateTime(free, timeZone, now)} (${timeZone}).`;
  }
  const last = runs[0];
  if (manual && last && Date.parse(last.at) + AGENT_MANUAL_INTERVAL_MS > now.getTime()) {
    const minutes = Math.ceil((Date.parse(last.at) + AGENT_MANUAL_INTERVAL_MS - now.getTime()) / 60_000);
    return `The agent ran less than an hour ago. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  }
  return null;
}

/** Atomic, durable reservation. A crash conservatively spends reserved slots.
 * Dispatch advances each slot to the actual attempt time. The scheduler
 * wakes at expiry so a daily run doesn't drift by a tick per day.
 */
export async function reserveRun(now: Date, manual: boolean, slots: readonly string[], timeZone = "UTC"): Promise<AgentRun | string> {
  if (slots.length < 1 || slots.length > AGENT_MAX_SLOTS_PER_RUN || [...perPortal(slots).values()].some((count) => count > AGENT_MAX_SOURCE_REQUESTS_PER_DAY)) {
    throw new Error("Invalid Agent source reservation");
  }
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, RUNS_LOCK);
    const runs = settingsFromRows(await tx.setting.findMany({ where: { key: "agentRuns" } })).agentRuns;
    const problem = runLimitProblem(runs, now, { manual, slots, timeZone });
    if (problem) return problem;
    const run: AgentRun = {
      at: now.toISOString(),
      manual,
      message: null,
      sourceRequests: slots.length,
      sourceRequestAts: Array(slots.length).fill(now.toISOString()),
      sourceRequestPortals: [...slots],
      searches: [],
    };
    const value = JSON.stringify([run, ...runs].slice(0, AGENT_RUNS_KEPT));
    await tx.setting.upsert({ where: { key: "agentRuns" }, create: { key: "agentRuns", value }, update: { value } });
    return run;
  });
}

/** Persist immediately before dispatch, including requests that will fail. */
export async function recordSourceRequest(run: AgentRun, index: number, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, RUNS_LOCK);
    const runs = settingsFromRows(await tx.setting.findMany({ where: { key: "agentRuns" } })).agentRuns;
    const entry = runs.find((entry) => entry.at === run.at);
    if (!entry || index < 0 || index >= (entry.sourceRequests ?? 1)) throw new Error("Agent source reservation no longer exists");
    const times = requestTimes(entry);
    times[index] = now.toISOString();
    entry.sourceRequestAts = times;
    await tx.setting.update({ where: { key: "agentRuns" }, data: { value: JSON.stringify(runs) } });
  });
}

/** Update under the same lock as admission so concurrent writers can't lose slots. */
export async function recordRunEnd(run: AgentRun, message: string | null, searches?: AgentSearchRun[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, RUNS_LOCK);
    const runs = settingsFromRows(await tx.setting.findMany({ where: { key: "agentRuns" } })).agentRuns;
    const value = JSON.stringify(runs.map((entry) => entry.at === run.at ? { ...entry, message, ...(searches ? { searches } : {}) } : entry));
    await tx.setting.upsert({ where: { key: "agentRuns" }, create: { key: "agentRuns", value }, update: { value } });
  });
}
