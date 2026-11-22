import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => "Europe/Berlin" }));
const sent = vi.hoisted(() => ({ events: [] as { name: string; data: unknown }[] }));
vi.mock("./notify", () => ({
  emit: vi.fn(async (name: string, data: unknown) => {
    sent.events.push({ name, data });
    return 1;
  }),
}));

const { runDailyCheck } = await import("./daily");

const prisma = () => db.client!;
// 16 November at 18:30 in Berlin.
const evening = new Date("2026-11-16T17:30:00Z");

beforeEach(async () => {
  await resetDatabase(prisma());
  sent.events = [];
  await saveSettings({ updateCheck: false });
});
afterAll(() => prisma().$disconnect());

describe("the daily notification check (E26-7)", () => {
  it("waits for 18:00 in the user's zone, then runs once a day", async () => {
    expect(await runDailyCheck(new Date("2026-11-16T16:30:00Z"))).toBe("waiting");
    expect(await runDailyCheck(evening)).toBe("ran");
    expect(await runDailyCheck(new Date("2026-11-16T21:00:00Z"))).toBe("done");
    expect((await loadSettings()).notificationsDay).toBe("2026-11-16");
  });

  it("says which interview is tomorrow, at its time in the user's zone, and which applications have had no news", async () => {
    await prisma().application.create({ data: { title: "Designer · Ledgerly", role: "Designer", company: "Ledgerly", status: "INTERVIEW", nextInterviewAt: new Date("2026-11-17T09:00:00Z") } });
    // The day after tomorrow, and an archived one: neither.
    await prisma().application.create({ data: { title: "Later", role: "Later", company: "Acme", status: "INTERVIEW", nextInterviewAt: new Date("2026-11-18T09:00:00Z") } });
    await prisma().application.create({ data: { title: "Old", role: "Old", company: "Gone", status: "INTERVIEW", nextInterviewAt: new Date("2026-11-17T09:00:00Z"), archivedAt: evening } });
    await prisma().application.create({ data: { title: "Quiet", role: "Quiet", company: "Hush", status: "SENT", sentAt: new Date("2026-11-01T09:00:00Z"), updatedAt: new Date("2026-11-01T09:00:00Z") } });

    await runDailyCheck(evening);
    expect(sent.events.map((event) => event.name)).toEqual(["interview.tomorrow", "followup.due"]);
    expect(sent.events[0].data).toMatchObject({ title: "Designer", company: "Ledgerly", time: "10:00" });
    expect(sent.events[1].data).toEqual({ applications: [{ id: expect.any(String), title: "Quiet", company: "Hush", days: 15 }] });
  });

  it("announces a new version once, while the daily update check is on", async () => {
    await saveSettings({ updateCheck: true });
    const checkUpdate = vi.fn(async () => saveSettings({ latestVersion: "99.0.0", latestVersionUrl: "https://github.com/AienTech/dossier/releases/tag/v99.0.0" }));
    await runDailyCheck(evening, { checkUpdate });
    expect(checkUpdate).toHaveBeenCalled();
    expect(sent.events).toEqual([{ name: "version.new", data: { version: "99.0.0", url: "https://github.com/AienTech/dossier/releases/tag/v99.0.0" } }]);
    // The next day, the same version isn't announced again.
    await runDailyCheck(new Date("2026-11-17T17:30:00Z"), { checkUpdate });
    expect(sent.events).toHaveLength(1);
  });
});
