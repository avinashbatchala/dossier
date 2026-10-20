import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { appVersion } from "@/lib/version";
import { createTestClient, resetDatabase } from "@/test/db";

import {
  askForUsagePing,
  pingIfNewDay,
  recordEnvChoice,
  saveUsagePingChoice,
  sendPing,
  USAGE_PING_NOTICE,
  USAGE_PING_QUESTION_NOTICE,
  USAGE_PING_TEXT_VERSION,
  USAGE_PING_URL,
  usagePingChoice,
  usagePingEnabled,
  usagePingNotice,
  utcDay,
} from "./usage-ping";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const telemetry = vi.hoisted(() => ({ value: undefined as "on" | "off" | undefined, testUrl: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({
  env: {
    get DOSSIER_TELEMETRY() {
      return telemetry.value;
    },
    get DOSSIER_USAGE_PING_TEST_URL() {
      return telemetry.testUrl;
    },
  },
}));

const prisma = () => db.client!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const morning = new Date("2026-10-16T08:00:00Z");
const evening = new Date("2026-10-16T21:00:00Z");
const nextDay = new Date("2026-10-17T00:30:00Z");

/** A fetch that answers every ping with `status` and records what it was sent. */
const answering = (status = 204) => vi.fn<typeof fetch>(async () => new Response(null, { status }));
/** What a recorded fetch was asked to send. */
const sent = (fetchImpl: ReturnType<typeof answering>) =>
  fetchImpl.mock.calls.map(([url, init]) => ({ url, method: init?.method, body: JSON.parse(String(init?.body)) as unknown }));
/** A new server process: it no longer remembers the day in memory. */
const restart = () => delete (globalThis as { usagePingDay?: string }).usagePingDay;

beforeEach(async () => {
  restart();
  telemetry.value = undefined;
  telemetry.testUrl = undefined;
  vi.stubEnv("NODE_ENV", "production");
  await resetDatabase(prisma());
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma().$disconnect());

const ID = "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c";
const answered = (choice: "on" | "off", text = USAGE_PING_TEXT_VERSION) => ({ usagePingChoice: choice, usagePingChoiceText: text });
const unanswered = { usagePingChoice: null, usagePingChoiceText: null };

describe("whether the usage ping goes (#172)", () => {
  it("follows DOSSIER_TELEMETRY while it's set, else the answer to the current question", () => {
    expect(usagePingChoice(unanswered, "on")).toEqual({ choice: "on", source: "env" });
    expect(usagePingChoice(answered("on"), "off")).toEqual({ choice: "off", source: "env" });
    expect(usagePingChoice(answered("on"), undefined)).toEqual({ choice: "on", source: "app" });
    expect(usagePingChoice(answered("off"), undefined)).toEqual({ choice: "off", source: "app" });
    expect(usagePingChoice(unanswered, undefined)).toEqual({ choice: null, source: null });
    // An answer to an older question counts as none: it's asked again.
    expect(usagePingChoice(answered("on", USAGE_PING_TEXT_VERSION - 1), undefined)).toEqual({ choice: null, source: null });
  });

  it("is on only after a yes, and asked only while nobody has answered, in production alone", () => {
    expect(usagePingEnabled(unanswered)).toBe(false);
    expect(askForUsagePing(unanswered)).toBe(true);
    expect(usagePingEnabled(answered("on"))).toBe(true);
    expect(askForUsagePing(answered("on"))).toBe(false);
    expect(usagePingEnabled(answered("off"))).toBe(false);
    telemetry.value = "off";
    expect(askForUsagePing(unanswered)).toBe(false);
    telemetry.value = "on";
    expect(usagePingEnabled(unanswered)).toBe(true);
    for (const mode of ["development", "test"]) {
      vi.stubEnv("NODE_ENV", mode);
      expect(usagePingEnabled(answered("on"))).toBe(false);
      expect(askForUsagePing(unanswered)).toBe(false);
    }
  });

  it("logs what it sends while it's on, how to answer while nobody has, and nothing once it's off", () => {
    expect(usagePingNotice(answered("on"))).toBe(USAGE_PING_NOTICE);
    expect(usagePingNotice(unanswered)).toBe(USAGE_PING_QUESTION_NOTICE);
    expect(usagePingNotice(answered("off"))).toBeNull();
    expect(USAGE_PING_NOTICE).not.toMatch(/Cloudflare/);
  });
});

describe("answering (#172)", () => {
  it("records the answer, when it was given and to which question", async () => {
    await saveUsagePingChoice("on", morning);
    expect(await loadSettings()).toMatchObject({ usagePingChoice: "on", usagePingChoiceAt: morning.toISOString(), usagePingChoiceText: USAGE_PING_TEXT_VERSION });
  });

  it("forgets the install's ID on a no, so a later yes starts a new one", async () => {
    await saveSettings({ usagePingId: ID, usagePingDay: "2026-10-15" });
    await saveUsagePingChoice("off", morning);
    expect(await loadSettings()).toMatchObject({ usagePingChoice: "off", usagePingId: null, usagePingDay: null });

    await saveUsagePingChoice("on", morning);
    const fetchImpl = answering();
    expect(await pingIfNewDay({ now: morning, fetchImpl })).toBe("sent");
    expect((await loadSettings()).usagePingId).not.toBe(ID);
  });

  it("keeps the ID of an install that pinged before, if it says yes", async () => {
    await saveSettings({ usagePingId: ID });
    await saveUsagePingChoice("on", morning);
    const fetchImpl = answering();
    await pingIfNewDay({ now: morning, fetchImpl });
    expect(sent(fetchImpl)[0].body).toEqual({ id: ID, version: appVersion });
  });

  it("records DOSSIER_TELEMETRY at startup when it's set; off forgets the ID", async () => {
    await saveSettings({ usagePingId: ID, usagePingDay: "2026-10-15" });
    await recordEnvChoice(undefined, morning);
    expect((await loadSettings()).usagePingChoice).toBeNull();

    await recordEnvChoice("off", morning);
    expect(await loadSettings()).toMatchObject({ usagePingChoice: "off", usagePingChoiceAt: morning.toISOString(), usagePingId: null });
    // Already on record: left as it was.
    await recordEnvChoice("off", evening);
    expect((await loadSettings()).usagePingChoiceAt).toBe(morning.toISOString());

    await recordEnvChoice("on", evening);
    expect(await loadSettings()).toMatchObject({ usagePingChoice: "on", usagePingChoiceAt: evening.toISOString() });
  });
});

describe("the usage ping", () => {
  it("counts days in UTC", () => {
    expect(utcDay(new Date("2026-10-16T23:59:59+02:00"))).toBe("2026-10-16");
    expect(utcDay(new Date("2026-10-17T01:00:00+02:00"))).toBe("2026-10-16");
  });

  it("sends nothing and stores nothing before a yes, in development, or with DOSSIER_TELEMETRY=off", async () => {
    const fetchImpl = answering();
    // An install that pinged before 1.8 and hasn't answered yet.
    await saveSettings({ usagePingId: ID });
    expect(await pingIfNewDay({ now: morning, fetchImpl })).toBe("skipped");
    restart();
    await saveUsagePingChoice("on", morning);
    expect(await pingIfNewDay({ now: morning, production: false, fetchImpl })).toBe("skipped");
    telemetry.value = "off";
    restart();
    expect(await pingIfNewDay({ now: morning, fetchImpl })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await loadSettings()).usagePingDay).toBeNull();
  });

  it("goes with DOSSIER_TELEMETRY=on without an answer in the app", async () => {
    telemetry.value = "on";
    const fetchImpl = answering();
    expect(await pingIfNewDay({ now: morning, fetchImpl })).toBe("sent");
  });

  it("goes on the next page after a yes, even later the same day", async () => {
    const fetchImpl = answering();
    expect(await pingIfNewDay({ now: morning, fetchImpl })).toBe("skipped");
    await saveUsagePingChoice("on", morning);
    expect(await pingIfNewDay({ now: evening, fetchImpl })).toBe("sent");
  });

  it("sends only a random install ID and the version, and keeps the ID", async () => {
    await saveUsagePingChoice("on", morning);
    const fetchImpl = answering();
    expect(await pingIfNewDay({ now: morning, fetchImpl })).toBe("sent");

    const { usagePingId, usagePingDay } = await loadSettings();
    expect(usagePingId).toMatch(UUID);
    expect(usagePingDay).toBe("2026-10-16");
    expect(sent(fetchImpl)).toEqual([{ url: USAGE_PING_URL, method: "POST", body: { id: usagePingId, version: appVersion } }]);
  });

  it("goes once a day, even across a restart, and the next day with the same ID", async () => {
    await saveUsagePingChoice("on", morning);
    const fetchImpl = answering();
    await pingIfNewDay({ now: morning, fetchImpl });
    expect(await pingIfNewDay({ now: evening, fetchImpl })).toBe("skipped");
    restart();
    expect(await pingIfNewDay({ now: evening, fetchImpl })).toBe("skipped");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    expect(await pingIfNewDay({ now: nextDay, fetchImpl })).toBe("sent");
    const [first, second] = sent(fetchImpl);
    expect(second.body).toEqual(first.body);
    expect((await loadSettings()).usagePingDay).toBe("2026-10-17");
  });

  it("sends it once when pages load at the same time", async () => {
    await saveUsagePingChoice("on", morning);
    const fetchImpl = answering();
    const results = await Promise.all([1, 2, 3].map(() => pingIfNewDay({ now: morning, fetchImpl })));
    expect(results.toSorted()).toEqual(["sent", "skipped", "skipped"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("doesn't try again the same day when it fails", async () => {
    await saveSettings({ usagePingId: ID });
    await saveUsagePingChoice("on", morning);
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await pingIfNewDay({ now: morning, fetchImpl: offline })).toBe("failed");
    restart();
    expect(await pingIfNewDay({ now: evening, fetchImpl: offline })).toBe("skipped");
    expect(offline).toHaveBeenCalledTimes(1);
    expect(await loadSettings()).toMatchObject({ usagePingId: ID, usagePingDay: "2026-10-16" });
  });

  it("counts an error answer as not arriving, and goes to the test receiver when one is set", async () => {
    expect(await sendPing(ID, answering(503))).toBe(false);
    expect(await sendPing(ID, answering(204))).toBe(true);
    telemetry.testUrl = "http://localhost:3998/ping";
    const fetchImpl = answering();
    await sendPing(ID, fetchImpl);
    expect(sent(fetchImpl)[0].url).toBe("http://localhost:3998/ping");
  });
});
