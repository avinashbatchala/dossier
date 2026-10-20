import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { USAGE_PING_TEXT_VERSION } from "@/lib/usage-ping";
import { createTestClient, resetDatabase } from "@/test/db";

import { chooseUsagePing, rememberDashboardPeriod, rememberQuietDays } from "./actions";

// The dashboard's actions run against the test database, signed in.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const telemetry = vi.hoisted(() => ({ value: undefined as "on" | "off" | undefined }));
vi.mock("@/lib/env", () => ({
  env: {
    get DOSSIER_TELEMETRY() {
      return telemetry.value;
    },
  },
}));

const prisma = () => db.client!;

beforeEach(async () => {
  telemetry.value = undefined;
  await resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

describe("the dashboard's settings", () => {
  it("remembers the period (E9-8)", async () => {
    expect(await rememberDashboardPeriod({ period: "90d" })).toEqual({ ok: true, data: null });
    expect((await loadSettings()).dashboardPeriod).toBe("90d");
  });

  it("remembers the follow-up threshold, within reason (E9-9)", async () => {
    expect(await rememberQuietDays({ days: 14 })).toEqual({ ok: true, data: null });
    expect((await loadSettings()).quietDays).toBe(14);
    expect(await rememberQuietDays({ days: 0 })).toMatchObject({ ok: false });
    expect(await rememberQuietDays({ days: 365 })).toMatchObject({ ok: false });
    expect((await loadSettings()).quietDays).toBe(14);
  });
});

describe("answering the usage ping question (#172)", () => {
  it("records a yes with its time and question, and a no that forgets the install ID", async () => {
    await saveSettings({ usagePingId: "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c", usagePingDay: "2026-10-19" });
    expect(await chooseUsagePing({ send: true })).toEqual({ ok: true, data: null });
    const yes = await loadSettings();
    expect(yes).toMatchObject({ usagePingChoice: "on", usagePingChoiceText: USAGE_PING_TEXT_VERSION, usagePingId: "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c" });
    expect(Date.parse(yes.usagePingChoiceAt!)).toBeGreaterThan(Date.now() - 60_000);

    expect(await chooseUsagePing({ send: false })).toEqual({ ok: true, data: null });
    expect(await loadSettings()).toMatchObject({ usagePingChoice: "off", usagePingId: null, usagePingDay: null });
  });

  it("changes nothing while DOSSIER_TELEMETRY decides", async () => {
    telemetry.value = "off";
    expect(await chooseUsagePing({ send: true })).toEqual({
      ok: false,
      error: "DOSSIER_TELEMETRY=off is set on the server, so it decides. Change it there.",
    });
    expect((await loadSettings()).usagePingChoice).toBeNull();
  });
});
