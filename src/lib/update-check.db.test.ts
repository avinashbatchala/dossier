import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import {
  availableUpdate,
  checkForUpdate,
  checkIfNewDay,
  dailyCheckRuns,
  isNewer,
  latestRelease,
  updateNotice,
  updateStatus,
} from "./update-check";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: {} }));

const prisma = () => db.client!;
const page = (version: string) => `https://github.com/AienTech/dossier/releases/tag/v${version}`;
/** A fetch that answers like GitHub's latest release. */
const answer = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => Response.json(body, { status }));
const releaseOf = (version: string) => answer(200, { tag_name: `v${version}`, html_url: page(version) });
const morning = new Date("2026-10-18T08:00:00Z");
const evening = new Date("2026-10-18T21:00:00Z");
const nextDay = new Date("2026-10-19T00:30:00Z");
/** A new server process: it no longer remembers the day in memory. */
const restart = () => delete (globalThis as { updateCheckDay?: string }).updateCheckDay;

beforeEach(async () => {
  restart();
  await resetDatabase(prisma());
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma().$disconnect());

describe("isNewer", () => {
  it("compares versions number by number", () => {
    expect(isNewer("1.10.0", "1.9.2")).toBe(true);
    expect(isNewer("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0-beta", "0.1.0")).toBe(false);
    expect(isNewer("0.0.9", "0.1.0")).toBe(false);
  });
});

describe("latestRelease (E10-9)", () => {
  it("asks GitHub for the latest release and nothing else", async () => {
    const fetch = releaseOf("0.2.0");
    expect(await latestRelease(fetch)).toEqual({ version: "0.2.0", url: page("0.2.0") });
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/AienTech/dossier/releases/latest", expect.objectContaining({ cache: "no-store" }));
    const [, init] = fetch.mock.calls[0];
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("asks the fake for the end-to-end tests instead, when set", async () => {
    const fetch = releaseOf("0.2.0");
    await latestRelease(fetch, "http://localhost:3998/github");
    expect(fetch.mock.calls[0][0]).toBe("http://localhost:3998/github/repos/AienTech/dossier/releases/latest");
  });

  it("can't tell offline, without a release, or from an answer that isn't one", async () => {
    expect(await latestRelease(answer(404, { message: "Not Found" }))).toBeNull();
    expect(await latestRelease(vi.fn(async () => Promise.reject(new TypeError("fetch failed"))))).toBeNull();
    expect(await latestRelease(answer(200, { tag_name: "v0.2.0" }))).toBeNull();
    expect(await latestRelease(answer(200, { tag_name: "v0.2.0", html_url: "https://example.com/v0.2.0" }))).toBeNull();
  });
});

describe("updateStatus", () => {
  it("says whether a release is newer than this version", () => {
    expect(updateStatus({ version: "0.2.0", url: page("0.2.0") }, "0.1.0")).toEqual({ status: "newer", version: "0.2.0", url: page("0.2.0") });
    expect(updateStatus({ version: "0.1.0", url: page("0.1.0") }, "0.1.0")).toEqual({ status: "latest", version: "0.1.0" });
    expect(updateStatus(null, "0.1.0")).toEqual({ status: "unknown" });
  });
});

describe("the sidebar's notice", () => {
  const seen = { latestVersion: "0.2.0", latestVersionUrl: page("0.2.0") };

  it("shows a newer release than this one", () => {
    expect(availableUpdate(seen, "0.1.0")).toEqual({ version: "0.2.0", url: page("0.2.0") });
    expect(updateNotice({ ...seen, updateDismissed: null }, "0.1.0")).toEqual({ version: "0.2.0", url: page("0.2.0") });
    expect(updateNotice({ ...seen, updateDismissed: null }, "0.2.0")).toBeNull();
    expect(updateNotice({ latestVersion: null, latestVersionUrl: null, updateDismissed: null }, "0.1.0")).toBeNull();
  });

  it("stays hidden after Not now, until a newer release still", () => {
    expect(updateNotice({ ...seen, updateDismissed: "0.2.0" }, "0.1.0")).toBeNull();
    expect(updateNotice({ latestVersion: "0.3.0", latestVersionUrl: page("0.3.0"), updateDismissed: "0.2.0" }, "0.1.0")).toEqual({
      version: "0.3.0",
      url: page("0.3.0"),
    });
  });

  it("never links a page off GitHub, whatever is stored", () => {
    expect(availableUpdate({ latestVersion: "0.2.0", latestVersionUrl: "https://example.com/" }, "0.1.0")).toBeNull();
  });
});

describe("checkForUpdate", () => {
  it("keeps the latest release it finds, and what it had when it can't tell", async () => {
    expect(await checkForUpdate(releaseOf("0.2.0"), "0.1.0")).toEqual({ status: "newer", version: "0.2.0", url: page("0.2.0") });
    expect(await loadSettings()).toMatchObject({ latestVersion: "0.2.0", latestVersionUrl: page("0.2.0") });
    expect(await checkForUpdate(answer(503, {}), "0.1.0")).toEqual({ status: "unknown" });
    expect(await loadSettings()).toMatchObject({ latestVersion: "0.2.0" });
  });
});

describe("the daily check", () => {
  it("runs in production only", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(dailyCheckRuns()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(dailyCheckRuns()).toBe(false);
  });

  it("asks once a day, even across restarts", async () => {
    const fetch = releaseOf("0.2.0");
    expect(await checkIfNewDay({ now: morning, runs: true, fetchImpl: fetch })).toBe("checked");
    expect(await checkIfNewDay({ now: evening, runs: true, fetchImpl: fetch })).toBe("skipped");
    restart();
    expect(await checkIfNewDay({ now: evening, runs: true, fetchImpl: fetch })).toBe("skipped");
    expect(await checkIfNewDay({ now: nextDay, runs: true, fetchImpl: fetch })).toBe("checked");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await loadSettings()).toMatchObject({ updateCheckDay: "2026-10-19", latestVersion: "0.2.0" });
  });

  it("doesn't ask while it's switched off, or outside production", async () => {
    const fetch = releaseOf("0.2.0");
    await saveSettings({ updateCheck: false });
    expect(await checkIfNewDay({ now: morning, runs: true, fetchImpl: fetch })).toBe("skipped");
    restart();
    await saveSettings({ updateCheck: true });
    expect(await checkIfNewDay({ now: morning, runs: false, fetchImpl: fetch })).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("doesn't try again the same day when GitHub doesn't answer", async () => {
    const offline = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("fetch failed")));
    expect(await checkIfNewDay({ now: morning, runs: true, fetchImpl: offline })).toBe("checked");
    restart();
    expect(await checkIfNewDay({ now: evening, runs: true, fetchImpl: offline })).toBe("skipped");
    expect(offline).toHaveBeenCalledTimes(1);
  });
});
