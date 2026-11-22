import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { clientIp } from "./client-ip";
import { browserKey, GLOBAL_KEY, ipKey, liftBlockOnEveryone, type LoginClient, startLoginAttempt } from "./login-throttle";

const db = createTestClient();
const start = new Date("2026-09-28T09:00:00Z");
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

/** A browser that never signed in here, at `ip`. */
const newBrowser = (ip: string): LoginClient => ({ ip, browser: null });

/** Attempts that all get the password wrong, one after another. */
async function failTimes(client: LoginClient | string, count: number, from = 0) {
  const who = typeof client === "string" ? newBrowser(client) : client;
  for (let i = 0; i < count; i++) expect((await startLoginAttempt(db, who, at(from + i))).allowed).toBe(true);
}

/** Tries once at `seconds`: 0 when let through (and counted), otherwise the wait and which limit refused it. */
async function tryAt(client: LoginClient | string, seconds: number) {
  const attempt = await startLoginAttempt(db, typeof client === "string" ? newBrowser(client) : client, at(seconds));
  return attempt.allowed ? 0 : { waitMs: attempt.waitMs, limit: attempt.limit };
}

const failures = async (key: string) => (await db.loginThrottle.findUnique({ where: { key } }))?.failures ?? null;

async function blockEveryone() {
  for (let i = 0; i < 30; i++) await failTimes(`10.0.0.${i}`, 1, i);
}

describe("login throttle", () => {
  it("blocks an IP for 30 s after five quick attempts, without affecting other IPs", async () => {
    await failTimes("203.0.113.7", 5);
    expect(await tryAt("203.0.113.7", 5)).toEqual({ waitMs: 29_000, limit: "client" });
    expect(await tryAt("198.51.100.2", 5)).toBe(0);
    // A refused attempt doesn't count: the block isn't made longer.
    expect(await tryAt("203.0.113.7", 6)).toEqual({ waitMs: 28_000, limit: "client" });
    expect(await tryAt("203.0.113.7", 34)).toBe(0);
  });

  it("lets only as many attempts through as the limit allows when they come at once (#329)", async () => {
    const burst = await Promise.all(Array.from({ length: 12 }, () => startLoginAttempt(db, newBrowser("203.0.113.7"), at(0))));
    expect(burst.filter((attempt) => attempt.allowed)).toHaveLength(5);
    expect(await failures(ipKey("203.0.113.7"))).toBe(5);
  });

  it("lets 30 through from many IPs at once (faked X-Forwarded-For), then blocks every new browser", async () => {
    const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => startLoginAttempt(db, newBrowser(`10.0.0.${i}`), at(0))));
    expect(burst.filter((attempt) => attempt.allowed)).toHaveLength(30);
    expect(await tryAt("10.0.0.99", 0)).toEqual({ waitMs: 30_000, limit: "everyone" });
  });

  it("starts the IP over after the right password, and takes the attempt back from the global count", async () => {
    await failTimes("203.0.113.7", 4);
    const attempt = await startLoginAttempt(db, newBrowser("203.0.113.7"), at(4));
    expect(await failures(GLOBAL_KEY)).toBe(5);
    if (!attempt.allowed) throw new Error("refused");
    await attempt.succeeded();
    expect(await failures(ipKey("203.0.113.7"))).toBeNull();
    expect(await failures(GLOBAL_KEY)).toBe(4);
  });

  it("lifts the block on everyone when the attempt that started it had the right password", async () => {
    for (let i = 0; i < 29; i++) await failTimes(`10.0.0.${i}`, 1, i);
    const attempt = await startLoginAttempt(db, newBrowser("203.0.113.7"), at(29));
    expect(await tryAt("10.0.0.99", 29)).toMatchObject({ limit: "everyone" });
    if (!attempt.allowed) throw new Error("refused");
    await attempt.succeeded();
    expect(await tryAt("10.0.0.99", 29)).toBe(0);
  });

  it("only takes one off when other attempts came in since, and keeps the block they started", async () => {
    for (let i = 0; i < 28; i++) await failTimes(`10.0.0.${i}`, 1, i);
    const attempt = await startLoginAttempt(db, newBrowser("203.0.113.7"), at(28));
    await failTimes("10.0.0.50", 1, 28);
    if (!attempt.allowed) throw new Error("refused");
    await attempt.succeeded();
    expect(await failures(GLOBAL_KEY)).toBe(29);
    expect(await tryAt("10.0.0.99", 28)).toMatchObject({ limit: "everyone" });
  });

  it("prunes rows untouched for a day", async () => {
    await failTimes("203.0.113.7", 1);
    await failTimes("198.51.100.2", 1, 24 * 60 * 60 + 1);
    expect((await db.loginThrottle.findMany({ select: { key: true }, orderBy: { key: "asc" } })).map((row) => row.key)).toEqual([
      GLOBAL_KEY,
      ipKey("198.51.100.2"),
    ]);
  });
});

describe("a browser that signed in before (#334)", () => {
  const known = (ip: string): LoginClient => ({ ip, browser: "b-1" });

  it("isn't stopped by the limit on everyone, and doesn't add to it", async () => {
    await blockEveryone();
    expect(await tryAt("198.51.100.2", 30)).toMatchObject({ limit: "everyone" });
    expect(await tryAt(known("198.51.100.2"), 30)).toBe(0);
    expect(await failures(GLOBAL_KEY)).toBe(30);
  });

  it("has a limit of its own, wherever it connects from", async () => {
    for (let i = 0; i < 5; i++) await failTimes(known(`10.0.1.${i}`), 1, i);
    expect(await tryAt(known("10.0.1.99"), 5)).toEqual({ waitMs: 29_000, limit: "client" });
    expect(await tryAt({ ip: "10.0.1.99", browser: "b-2" }, 5)).toBe(0);
  });

  it("is still held to its IP's limit", async () => {
    await failTimes("203.0.113.7", 5);
    expect(await tryAt(known("203.0.113.7"), 5)).toMatchObject({ limit: "client" });
  });

  it("starts over, with its IP, after the right password", async () => {
    await failTimes(known("203.0.113.7"), 4);
    const attempt = await startLoginAttempt(db, known("203.0.113.7"), at(4));
    if (!attempt.allowed) throw new Error("refused");
    await attempt.succeeded();
    expect(await failures(browserKey("b-1"))).toBeNull();
    expect(await failures(ipKey("203.0.113.7"))).toBeNull();
  });
});

describe("the limit on everyone", () => {
  it("can't be reached through an address sent as its key", async () => {
    await failTimes("*", 5);
    expect(await tryAt("*", 5)).toMatchObject({ limit: "client" });
    expect(await tryAt("198.51.100.2", 5)).toBe(0);
  });

  it("is lifted when Dossier starts, while each IP's stays", async () => {
    // A known browser, so these count for the IP only.
    await failTimes({ ip: "203.0.113.7", browser: "b-9" }, 5);
    await blockEveryone();
    await liftBlockOnEveryone(db);
    expect(await tryAt("198.51.100.2", 30)).toBe(0);
    expect(await tryAt("203.0.113.7", 30)).toMatchObject({ limit: "client" });
  });
});

describe("clientIp", () => {
  it("takes the last X-Forwarded-For entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
