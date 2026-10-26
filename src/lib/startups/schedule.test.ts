import { afterEach, describe, expect, it, vi } from "vitest";

import { startDueStartupsRefresh, startStartupsSchedule, startupsRefreshDue } from "./schedule";

const state = vi.hoisted(() => ({
  settings: { startupsViewedAt: null as string | null, startupsLastRefresh: null as { at: string } | null },
  unfinished: [] as { id: string }[],
}));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => state.settings }));
vi.mock("@/lib/jobs/runner", () => ({ findUnfinishedJobs: async () => state.unfinished }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
const start = vi.hoisted(() => vi.fn(async () => "job-1"));
vi.mock("./refresh", () => ({ STARTUPS_JOB_KEY: "startups-refresh", startStartupsRefresh: start }));

afterEach(() => {
  start.mockClear();
  state.unfinished = [];
});

const now = new Date("2026-10-23T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const refresh = (at: string) => ({ at, added: 0, sources: [], emailsFound: 0 });

describe("Startups' daily refresh (#222)", () => {
  it("waits for the first refresh by hand, and runs daily while the screen is in use", () => {
    expect(startupsRefreshDue({ startupsViewedAt: hoursAgo(1), startupsLastRefresh: null }, now)).toBe(false);
    expect(startupsRefreshDue({ startupsViewedAt: null, startupsLastRefresh: refresh(hoursAgo(30)) }, now)).toBe(false);
    expect(startupsRefreshDue({ startupsViewedAt: hoursAgo(1), startupsLastRefresh: refresh(hoursAgo(21)) }, now)).toBe(false);
    expect(startupsRefreshDue({ startupsViewedAt: hoursAgo(1), startupsLastRefresh: refresh(hoursAgo(22)) }, now)).toBe(true);
    expect(startupsRefreshDue({ startupsViewedAt: hoursAgo(15 * 24), startupsLastRefresh: refresh(hoursAgo(30)) }, now)).toBe(false);
  });

  it("starts the refresh when due, unless one is under way", async () => {
    state.settings = { startupsViewedAt: hoursAgo(1), startupsLastRefresh: refresh(hoursAgo(23)) };
    expect(await startDueStartupsRefresh(now)).toBe("job-1");
    state.unfinished = [{ id: "running" }];
    expect(await startDueStartupsRefresh(now)).toBeNull();
    state.settings = { startupsViewedAt: null, startupsLastRefresh: null };
    expect(await startDueStartupsRefresh(now)).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts one timer per process", () => {
    const timer = vi.spyOn(globalThis, "setInterval");
    startStartupsSchedule();
    startStartupsSchedule();
    expect(timer).toHaveBeenCalledTimes(1);
    timer.mockRestore();
  });
});
