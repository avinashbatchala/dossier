import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INSTALL_SETTINGS } from "@/lib/data-export";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { settingsFromRows } from "@/lib/settings";
import { createTestClient, resetDatabase } from "@/test/db";

import { askBackend, checkAnnouncements, checkAnnouncementsIfDue, checkDue, checkRuns, waitSeconds } from "./check";
import type { AnnouncementFeed } from "./contract";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const config = vi.hoisted(() => ({ DOSSIER_API_URL: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: config }));
const log = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({ logServerError: log }));

const prisma = () => db.client!;
const HOUR = 60 * 60;
const now = new Date("2026-11-05T12:00:00Z");
const hoursLater = (hours: number) => new Date(now.getTime() + hours * HOUR * 1000).toISOString();
const notice = (id: string) => ({
  id,
  severity: "info" as const,
  title: "A notice",
  body: "Its text.",
  link: null,
  minVersion: null,
  maxVersion: null,
  publishedAt: "2026-11-01T09:00:00.000Z",
  expiresAt: null,
});
const feed = (changes: Partial<AnnouncementFeed> = {}): AnnouncementFeed => ({
  items: [notice("ann_old")],
  etag: '"old"',
  appVersion: "1.13.0",
  nextCheckAt: hoursLater(-1),
  ...changes,
});
/** A fetch answering with this body, like the backend. */
const answer = (body: unknown, { status = 200, etag = '"new"', cacheControl = `public, max-age=${12 * HOUR}` } = {}) =>
  vi.fn<typeof fetch>(async () => Response.json(body, { status, headers: { etag, "cache-control": cacheControl } }));
const notModified = (cacheControl = `public, max-age=${12 * HOUR}`) =>
  vi.fn<typeof fetch>(async () => new Response(null, { status: 304, headers: { "cache-control": cacheControl } }));
const check = (fetchImpl: typeof fetch, current = "1.13.0") => checkAnnouncements({ now, fetchImpl, current, base: "https://backend.test/v1" });
const stored = async () => (await loadSettings()).announcementFeed;

beforeEach(async () => {
  config.DOSSIER_API_URL = undefined;
  log.mockClear();
  await resetDatabase(prisma());
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma().$disconnect());

describe("waitSeconds", () => {
  it("is what the answer says, between 1 hour and 7 days", () => {
    expect(waitSeconds("public, max-age=21600")).toBe(21600);
    expect(waitSeconds("max-age=60")).toBe(HOUR);
    expect(waitSeconds("MAX-AGE=999999999")).toBe(7 * 24 * HOUR);
  });

  it("is 6 hours when the answer doesn't say", () => {
    for (const header of [null, "", "no-store", "s-maxage=60", "max-age=soon"]) expect(waitSeconds(header)).toBe(6 * HOUR);
  });
});

describe("checkDue", () => {
  it("is due without an earlier answer, and once the time has come", () => {
    expect(checkDue(null, now)).toBe(true);
    expect(checkDue(feed({ nextCheckAt: hoursLater(-1) }), now)).toBe(true);
    expect(checkDue(feed({ nextCheckAt: now.toISOString() }), now)).toBe(true);
    expect(checkDue(feed({ nextCheckAt: hoursLater(1) }), now)).toBe(false);
  });

  it("is always due on a development server, so a local backend's changes show at once", () => {
    expect(checkDue(feed({ nextCheckAt: hoursLater(1) }), now, true)).toBe(true);
    expect(checkDue(feed({ nextCheckAt: hoursLater(1) }), now, false)).toBe(false);
  });

  it("doesn't wait for a date further off than the longest wait", () => {
    expect(checkDue(feed({ nextCheckAt: hoursLater(7 * 24) }), now)).toBe(false);
    expect(checkDue(feed({ nextCheckAt: hoursLater(7 * 24 + 1) }), now)).toBe(true);
  });
});

describe("checkRuns", () => {
  it("runs in production, and elsewhere only when pointed at a backend", () => {
    expect(checkRuns()).toBe(false);
    config.DOSSIER_API_URL = "http://api.localhost:3000/v1";
    expect(checkRuns()).toBe(true);
    config.DOSSIER_API_URL = undefined;
    vi.stubEnv("NODE_ENV", "production");
    expect(checkRuns()).toBe(true);
  });
});

describe("askBackend", () => {
  it("sends nothing about the install", async () => {
    const fetch = answer({ announcements: [] });
    await askBackend(null, fetch);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.dossier.aien.me/v1/announcements");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({ accept: "application/json", "user-agent": "Dossier" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses DOSSIER_API_URL, and the ETag when it has one", async () => {
    config.DOSSIER_API_URL = "http://api.localhost:3000/v1";
    const fetch = notModified();
    await askBackend('"abc"', fetch, config.DOSSIER_API_URL);
    expect(fetch.mock.calls[0][0]).toBe("http://api.localhost:3000/v1/announcements");
    expect(fetch.mock.calls[0][1]?.headers).toEqual({ accept: "application/json", "user-agent": "Dossier", "if-none-match": '"abc"' });
  });

  it("reads each kind of answer", async () => {
    expect(await askBackend(null, answer({ announcements: [notice("ann_1")] }))).toEqual({ status: "new", items: [notice("ann_1")], etag: '"new"', wait: 12 * HOUR });
    expect(await askBackend('"new"', notModified())).toEqual({ status: "same", wait: 12 * HOUR });
  });

  it("calls anything else a failure, without throwing", async () => {
    const failures: (typeof fetch)[] = [
      answer({ error: { code: "unavailable", message: "Down." } }, { status: 503 }),
      answer({ error: { code: "rate_limited", message: "Too many requests." } }, { status: 429 }),
      answer({ error: { code: "not_found", message: "Not found." } }, { status: 404 }),
      answer({ surprise: true }),
      vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 200 })),
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
      vi.fn(async () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))),
    ];
    for (const failure of failures) expect(await askBackend(null, failure)).toEqual({ status: "failed" });
  });

  it("refuses an answer that's too big", async () => {
    const big = JSON.stringify({ announcements: [], padding: "x".repeat(1024 * 1024) });
    expect(await askBackend(null, vi.fn(async () => new Response(big)))).toEqual({ status: "failed" });
    const announced = vi.fn(async () => new Response("{}", { headers: { "content-length": String(2 * 1024 * 1024) } }));
    expect(await askBackend(null, announced)).toEqual({ status: "failed" });
  });
});

describe("checkAnnouncements", () => {
  it("keeps a new answer and when to ask next", async () => {
    expect(await check(answer({ announcements: [notice("ann_1")] }))).toBe("checked");
    expect(await stored()).toEqual({ items: [notice("ann_1")], etag: '"new"', appVersion: "1.13.0", nextCheckAt: hoursLater(12) });
  });

  it("replaces the list, so withdrawn and expired notices leave it", async () => {
    await saveSettings({ announcementFeed: feed() });
    await check(answer({ announcements: [] }));
    expect((await stored())?.items).toEqual([]);
  });

  it("keeps the list on a 304, and asks with the ETag", async () => {
    await saveSettings({ announcementFeed: feed() });
    const fetch = notModified();
    expect(await check(fetch)).toBe("checked");
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ "if-none-match": '"old"' });
    expect(await stored()).toEqual(feed({ nextCheckAt: hoursLater(12) }));
  });

  it("asks without the ETag after an update, since this version may read more of the same answer", async () => {
    await saveSettings({ announcementFeed: feed() });
    const fetch = answer({ announcements: [notice("ann_1")] });
    await check(fetch, "1.14.0");
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty("if-none-match");
    expect((await stored())?.appVersion).toBe("1.14.0");
  });

  it("keeps the last good answer when the backend fails, and tries again in 6 hours", async () => {
    await saveSettings({ announcementFeed: feed() });
    expect(await check(answer({}, { status: 503 }))).toBe("failed");
    expect(await stored()).toEqual(feed({ nextCheckAt: hoursLater(6) }));
    expect(log).not.toHaveBeenCalled();
  });

  it("remembers a failure on the first check too, so it isn't tried on every page", async () => {
    const down = vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("fetch failed")));
    expect(await check(down)).toBe("failed");
    expect(await stored()).toEqual({ items: [], etag: null, appVersion: "1.13.0", nextCheckAt: hoursLater(6) });
    expect(await check(down)).toBe("skipped");
    expect(down).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask before it's time", async () => {
    await saveSettings({ announcementFeed: feed({ nextCheckAt: hoursLater(1) }) });
    const fetch = answer({ announcements: [] });
    expect(await check(fetch)).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks once when pages load together", async () => {
    const fetch = answer({ announcements: [] });
    expect(await Promise.all([check(fetch), check(fetch), check(fetch)])).toEqual(expect.arrayContaining(["checked", "skipped", "skipped"]));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("can run again after one that threw", async () => {
    const spy = vi.spyOn(prisma().setting, "findMany").mockRejectedValueOnce(new Error("database down"));
    await expect(check(answer({ announcements: [] }))).rejects.toThrow("database down");
    spy.mockRestore();
    expect(await check(answer({ announcements: [] }))).toBe("checked");
  });
});

describe("checkAnnouncementsIfDue", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("does nothing while it doesn't run, or isn't due", async () => {
    const fetch = answer({ announcements: [] });
    globalThis.fetch = fetch;
    await checkAnnouncementsIfDue({ announcementFeed: null });
    config.DOSSIER_API_URL = "https://backend.test/v1";
    await checkAnnouncementsIfDue({ announcementFeed: feed({ nextCheckAt: new Date(Date.now() + HOUR * 1000).toISOString() }) });
    expect(fetch).not.toHaveBeenCalled();
    expect(await stored()).toBeNull();
  });

  it("logs a problem of its own instead of throwing", async () => {
    config.DOSSIER_API_URL = "https://backend.test/v1";
    globalThis.fetch = answer({ announcements: [] });
    const spy = vi.spyOn(prisma().setting, "findMany").mockRejectedValueOnce(new Error("database down"));
    await expect(checkAnnouncementsIfDue({ announcementFeed: null })).resolves.toBeUndefined();
    spy.mockRestore();
    expect(log).toHaveBeenCalledWith("announcements", expect.any(Error));
  });
});

describe("what Settings keeps", () => {
  it("belongs to the install, so exports leave it out", () => {
    expect(INSTALL_SETTINGS).toEqual(expect.arrayContaining(["announcementFeed", "announcementsDismissed"]));
  });

  it("reads anything it can't use as nothing kept, so the next page asks again", () => {
    const read = (value: string) => settingsFromRows([{ key: "announcementFeed", value }]).announcementFeed;
    expect(read("not json")).toBeNull();
    expect(read('{"items":"none"}')).toBeNull();
    expect(read(JSON.stringify(feed()))).toEqual(feed());
    expect(settingsFromRows([]).announcementFeed).toBeNull();
    expect(settingsFromRows([]).announcementsDismissed).toEqual([]);
  });
});
