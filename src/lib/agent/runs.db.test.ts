import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { nextSourceBudgetAt, recordRunEnd, recordSourceRequest, reserveRun, runLimitProblem, sourceRequestsInPastDay } from "./runs";
import { checkAgentSchedule, nextAgentRun, startDueRun } from "./schedule";
import { saveAgentSearch } from "./searches";
import { EMPTY_QUERY } from "@/lib/job-search/search";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// The job search settings read the environment (E22-8: the budget counts each portal's requests).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "UTC" }));
vi.mock("@/lib/jobs/runner", async (original) => ({ ...(await original<typeof import("@/lib/jobs/runner")>()), startJob: vi.fn(async () => "scheduled") }));
const prisma = () => db.client!;
const now = new Date("2026-10-20T07:00:00Z");
const day = 86_400_000;
/** `count` requests to one portal. */
const slots = (count: number, portal = "JSEARCH") => Array<string>(count).fill(portal);
beforeEach(async () => { await resetDatabase(prisma()); });
afterAll(() => prisma().$disconnect());

/** FreeHire switched on: no key, every country. */
const FREEHIRE_ON = { FREEHIRE: { on: true, fields: {}, acceptedAt: null } };

describe("durable source-request budget", () => {
  it("admits only one concurrent two-slot reservation and preserves it across clients/restarts", async () => {
    const reservations = await Promise.all([reserveRun(now, false, slots(2)), reserveRun(now, false, slots(2))]);
    expect(reservations.filter((run) => typeof run !== "string")).toHaveLength(1);
    const otherClient = createTestClient();
    try {
      const ledger = await otherClient.setting.findUniqueOrThrow({ where: { key: "agentRuns" } });
      expect(JSON.parse(ledger.value)).toMatchObject([{ sourceRequests: 2 }]);
    } finally { await otherClient.$disconnect(); }
    // New process can only read the same durable reservations, not reset quota.
    expect(await reserveRun(new Date(now.getTime() + 3_600_000), false, slots(2))).toContain("Next eligible");
    expect(sourceRequestsInPastDay((await loadSettings()).agentRuns, now, "JSEARCH")).toBe(2);
  });

  it("waits for enough slots for the whole run, and admits at the exact 24h boundary", async () => {
    await reserveRun(now, false, slots(1));
    const later = new Date(now.getTime() + 5_000);
    await reserveRun(later, false, slots(2));
    const boundary = new Date(now.getTime() + day);
    const runs = (await loadSettings()).agentRuns;
    expect(nextSourceBudgetAt(runs, boundary, slots(3))).toEqual(new Date(later.getTime() + day));
    expect(runLimitProblem(runs, new Date(later.getTime() + day - 1), { manual: false, slots: slots(3) })).not.toBeNull();
    expect(typeof await reserveRun(new Date(later.getTime() + day), false, slots(3))).toBe("object");
  });

  it("counts attempts at dispatch, not just reservation time, including the last slow search", async () => {
    const run = await reserveRun(now, false, slots(3));
    if (typeof run === "string") throw new Error(run);
    await recordSourceRequest(run, 0, now);
    await recordSourceRequest(run, 1, new Date(now.getTime() + 3_000));
    await recordSourceRequest(run, 2, new Date(now.getTime() + 6_000));
    const boundary = new Date(now.getTime() + day);
    const runs = (await loadSettings()).agentRuns;
    expect(sourceRequestsInPastDay(runs, boundary, "JSEARCH")).toBe(2);
    expect(nextSourceBudgetAt(runs, boundary, slots(3))).toEqual(new Date(boundary.getTime() + 6_000));
    expect(await reserveRun(new Date(boundary.getTime() + 5_999), false, slots(3))).toContain("Next eligible");
    expect(typeof await reserveRun(new Date(boundary.getTime() + 6_000), false, slots(3))).toBe("object");
  });

  it("doesn't lose concurrent end updates or source reservations", async () => {
    const run = await reserveRun(now, false, slots(1));
    if (typeof run === "string") throw new Error(run);
    await Promise.all([
      recordRunEnd(run, "Finished", [{ searchId: "a", searchName: "A", found: 1, fresh: 1, error: null }]),
      reserveRun(new Date(now.getTime() + 1), false, slots(2)),
    ]);
    const runs = (await loadSettings()).agentRuns;
    expect(sourceRequestsInPastDay(runs, new Date(now.getTime() + 2), "JSEARCH")).toBe(3);
    expect(runs.find((entry) => entry.at === run.at)?.message).toBe("Finished");
  });

  it("admits tomorrow's daily tick when all three reserved request slots have expired", async () => {
    await saveSettings({ agentEnabled: true, agentHour: 7, portals: FREEHIRE_ON });
    for (let i = 0; i < 3; i++) await saveAgentSearch({ name: `Search ${i}`, query: { ...EMPTY_QUERY, keywords: `Job ${i}`, country: "nl" }, sort: i, enabled: true });
    const run = await reserveRun(now, false, slots(3, "FREEHIRE"));
    if (typeof run === "string") throw new Error(run);
    await recordRunEnd(run, "Finished seconds later");
    const tomorrow = new Date(now.getTime() + day);
    const runs = (await loadSettings()).agentRuns;
    expect(nextAgentRun(now, 7, "UTC", runs, slots(3, "FREEHIRE"))).toEqual(tomorrow);
    expect(await startDueRun(new Date(tomorrow.getTime() - 1))).toBeNull();
    expect(await startDueRun(tomorrow)).toBe("scheduled");
  });

  it("wakes at budget expiry seconds after a daily tick, rather than drifting another 15 minutes", async () => {
    await saveAgentSearch({ name: "Search", query: { ...EMPTY_QUERY, keywords: "Designer", country: "nl" }, sort: 0, enabled: true });
    await saveSettings({ agentEnabled: true, agentHour: 7, portals: FREEHIRE_ON, agentRuns: [{ at: new Date(now.getTime() - day + 5_000).toISOString(), sourceRequests: 3, manual: false, message: "Finished" }] });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      const runs = (await loadSettings()).agentRuns;
      expect(nextAgentRun(now, 7, "UTC", runs, slots(1, "FREEHIRE"))).toEqual(new Date(now.getTime() + 5_000));
      await checkAgentSchedule();
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 5_000);
    } finally {
      for (const result of timer.mock.results) if (result.type === "return") clearTimeout(result.value);
      timer.mockRestore();
      vi.useRealTimers();
    }
  });

  it("counts each portal's requests apart (E22-8)", async () => {
    const run = await reserveRun(now, false, ["JSEARCH", "JSEARCH", "ADZUNA"]);
    if (typeof run === "string") throw new Error(run);
    const runs = (await loadSettings()).agentRuns;
    expect([sourceRequestsInPastDay(runs, now, "JSEARCH"), sourceRequestsInPastDay(runs, now, "ADZUNA"), sourceRequestsInPastDay(runs, now, "FREEHIRE")]).toEqual([2, 1, 0]);
    // JSearch has room for one more, Adzuna for two, FreeHire for three.
    expect(runLimitProblem(runs, now, { manual: false, slots: ["JSEARCH", "ADZUNA", "ADZUNA", ...slots(3, "FREEHIRE")] })).toBeNull();
    expect(runLimitProblem(runs, now, { manual: false, slots: ["ADZUNA", ...slots(2, "JSEARCH")] })).toBe(
      "The agent needs 2 requests to JSearch this run, but may send each portal only 3 in 24 hours. Next eligible: Wed 21 Oct, 07:00 (UTC).",
    );
    await expect(reserveRun(now, false, slots(4, "FREEHIRE"))).rejects.toThrow("Invalid Agent source reservation");
  });

  it("counts a slot from before against every portal", async () => {
    await saveSettings({ agentRuns: [{ at: now.toISOString(), sourceRequests: 2, manual: false, message: "Finished" }] });
    const runs = (await loadSettings()).agentRuns;
    expect([sourceRequestsInPastDay(runs, now, "JSEARCH"), sourceRequestsInPastDay(runs, now, "ADZUNA")]).toEqual([2, 2]);
    expect(nextSourceBudgetAt(runs, now, slots(2, "ADZUNA"))).toEqual(new Date(now.getTime() + day));
  });
});
