import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptSecret, NOTIFICATION_SECRET } from "@/lib/secrets";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const runtime = vi.hoisted(() => ({ env: { DOSSIER_SECRET: "a".repeat(32) } as Record<string, string | undefined>, desktop: false }));
vi.mock("@/lib/env", () => ({ env: runtime.env }));
vi.mock("@/lib/desktop", () => ({ isDesktopApp: () => runtime.desktop }));
// Deliveries are queued as jobs; here it's enough to see them queued.
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/jobs/runner")>()), startJob: vi.fn(async () => "job") }));

const { startJob } = await import("@/lib/jobs/runner");
const { attemptDelivery, emit, sendDueDeliveries, sendTest } = await import("./notify");
const { listChannels, listDeliveries, regenerateWebhookSecret, saveChannel, setChannelEvent, webhookSecret } = await import("./store");

const prisma = () => db.client!;
const now = new Date("2026-11-16T07:00:00Z");
const run = { newCount: 0, searches: [], failed: [], postings: [], path: "/jobs?found=agent" };
const webhook = (name = "n8n") => saveChannel({ type: "WEBHOOK", name, config: { url: "https://n8n.example/hook" }, secret: { action: "keep" } });

beforeEach(async () => {
  await resetDatabase(prisma());
  runtime.env.DOSSIER_PUBLIC_URL = undefined;
  runtime.desktop = false;
  vi.mocked(startJob).mockClear();
});
afterAll(() => prisma().$disconnect());

describe("channels (E26-2, E26-3)", () => {
  it("keep their secret encrypted and never show it; a webhook gets one of its own, to copy or remake", async () => {
    const inbox = await saveChannel({ type: "EMAIL", name: "Inbox", config: { host: "smtp.example.com", port: 587, user: "me", from: "a@b.c", to: "d@e.f" }, secret: { action: "set", value: "pw" } });
    expect(inbox).toMatchObject({ hasSecret: true, summary: "smtp.example.com → d@e.f" });
    expect(JSON.stringify(await listChannels())).not.toContain("pw");
    const row = await prisma().notificationChannel.findUniqueOrThrow({ where: { id: inbox.id } });
    expect(decryptSecret(NOTIFICATION_SECRET, row.secretEnc!)).toBe("pw");

    const hook = await webhook();
    const secret = await webhookSecret(hook.id);
    expect(secret).toMatch(/^whsec_/);
    expect(await regenerateWebhookSecret(hook.id)).not.toBe(secret);
  });

  it("start each event at its default, and keep a switch", async () => {
    const hook = await webhook();
    expect(hook.events).toMatchObject({ "agent.run.finished": true, "portal.withdrawn": true, "draft.ready": false, "version.new": false });
    expect((await setChannelEvent(hook.id, "agent.run.finished", false)).events["agent.run.finished"]).toBe(false);
  });

  it("warn about a public ntfy topic without a token", async () => {
    const phone = await saveChannel({ type: "NTFY", name: "Phone", config: { server: "https://ntfy.sh", topic: "dossier" }, secret: { action: "keep" } });
    expect(phone.warning).toBe("Anyone who knows this topic can read these messages. Use a hard-to-guess topic or an access token.");
    expect((await saveChannel({ id: phone.id, type: "NTFY", name: "Phone", config: { server: "https://ntfy.sh", topic: "dossier" }, secret: { action: "set", value: "tk" } })).warning).toBeNull();
  });
});

describe("emit (E26-1)", () => {
  it("queues one delivery for each channel that wants the event, with the link made absolute", async () => {
    await saveSettings({ lastOrigin: "https://dossier.example" });
    const wants = await webhook("n8n");
    const off = await webhook("Other");
    await setChannelEvent(off.id, "agent.run.finished", false);
    const paused = await webhook("Paused");
    await prisma().notificationChannel.update({ where: { id: paused.id }, data: { pausedAt: now } });

    expect(await emit("agent.run.finished", { ...run, newCount: 2 }, now)).toBe(1);
    const [delivery] = await prisma().notificationDelivery.findMany();
    expect(delivery).toMatchObject({ channelId: wants.id, event: "agent.run.finished", status: "PENDING", attempts: 0 });
    expect(delivery.message).toMatchObject({ title: "Agent run finished · 2 new postings", link: "https://dossier.example/jobs?found=agent", data: { newCount: 2 } });
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ type: "notification-delivery" }), { deliveryId: delivery.id }, { key: `notification:${delivery.id}` });
  });

  it("sends a run with nothing new only to channels that want every run, and never fails the caller", async () => {
    const quiet = await webhook("Quiet");
    const every = await webhook("Every");
    await prisma().notificationChannel.update({ where: { id: every.id }, data: { onlyNew: false } });
    expect(await emit("agent.run.finished", run, now)).toBe(1);
    expect((await prisma().notificationDelivery.findFirstOrThrow()).channelId).toBe(every.id);
    // A failed portal counts as something to report.
    expect(await emit("agent.run.finished", { ...run, failed: [{ portal: "JSearch", why: "out of searches" }] }, now)).toBe(2);
    void quiet;
  });

  it("links to DOSSIER_PUBLIC_URL first, and to nothing on the desktop app's own computer", async () => {
    await saveSettings({ lastOrigin: "http://localhost:3000" });
    runtime.env.DOSSIER_PUBLIC_URL = "https://jobs.example.org/";
    await webhook();
    await emit("portal.withdrawn", { portal: "Jobicy", why: "Its API was shut down." }, now);
    expect((await prisma().notificationDelivery.findFirstOrThrow()).message).toMatchObject({ link: "https://jobs.example.org/settings?section=jobs" });
    runtime.desktop = true;
    await emit("portal.withdrawn", { portal: "Jobicy", why: "Its API was shut down." }, now);
    expect((await prisma().notificationDelivery.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).message).toMatchObject({ link: null });
  });
});

describe("deliveries (E26-1)", () => {
  const answer = (status: number) => vi.fn(async () => new Response("", { status }));

  it("try again after 1, 5 and 30 minutes, then fail, counting the channel's failures", async () => {
    const hook = await webhook();
    await emit("portal.withdrawn", { portal: "Jobicy", why: "Gone." }, now);
    const { id } = await prisma().notificationDelivery.findFirstOrThrow();
    let at = now;
    for (const minutes of [1, 5, 30]) {
      expect(await attemptDelivery(id, { now: at, fetchImpl: answer(500) })).toBe("PENDING");
      const row = await prisma().notificationDelivery.findUniqueOrThrow({ where: { id } });
      expect(row.nextAt.getTime() - at.getTime()).toBe(minutes * 60_000);
      expect(row.error).toBe("The webhook answered 500.");
      at = row.nextAt;
    }
    expect(await attemptDelivery(id, { now: at, fetchImpl: answer(500) })).toBe("FAILED");
    expect(await prisma().notificationChannel.findUniqueOrThrow({ where: { id: hook.id } })).toMatchObject({ failuresInARow: 1, pausedAt: null });
    expect((await listDeliveries())[0]).toMatchObject({ event: "A portal you use was withdrawn", channel: "n8n", status: "FAILED", attempts: 4, error: "The webhook answered 500." });
  });

  it("pause a channel after 10 failed deliveries in a row, and start counting again after one is sent", async () => {
    const hook = await webhook();
    await prisma().notificationChannel.update({ where: { id: hook.id }, data: { failuresInARow: 9 } });
    const delivery = await prisma().notificationDelivery.create({ data: { channelId: hook.id, event: "test", message: { event: "test", title: "t", text: "x", link: null, at: now.toISOString(), data: {} }, attempts: 3 } });
    expect(await attemptDelivery(delivery.id, { now, fetchImpl: answer(404) })).toBe("FAILED");
    expect((await listChannels())[0]).toMatchObject({ failuresInARow: 10, pausedAt: now.toISOString() });
    // Nothing more goes to it while it's paused.
    expect(await emit("portal.withdrawn", { portal: "Jobicy", why: "Gone." }, now)).toBe(0);

    await prisma().notificationChannel.update({ where: { id: hook.id }, data: { pausedAt: null } });
    const next = await prisma().notificationDelivery.create({ data: { channelId: hook.id, event: "test", message: { event: "test", title: "t", text: "x", link: null, at: now.toISOString(), data: {} } } });
    expect(await attemptDelivery(next.id, { now, fetchImpl: answer(200) })).toBe("SENT");
    expect((await listChannels())[0].failuresInARow).toBe(0);
  });

  it("are queued again when they're due, and when a restart left one half-done", async () => {
    const hook = await webhook();
    const message = { event: "test", title: "t", text: "x", link: null, at: now.toISOString(), data: {} };
    const due = await prisma().notificationDelivery.create({ data: { channelId: hook.id, event: "test", message, nextAt: new Date(now.getTime() - 1000) } });
    await prisma().notificationDelivery.create({ data: { channelId: hook.id, event: "test", message, nextAt: new Date(now.getTime() + 60_000) } });
    const stuck = await prisma().notificationDelivery.create({ data: { channelId: hook.id, event: "test", message, status: "SENDING" } });
    await prisma().$executeRaw`UPDATE "NotificationDelivery" SET "updatedAt" = ${new Date(now.getTime() - 20 * 60_000)} WHERE id = ${stuck.id}`;
    expect(await sendDueDeliveries(now)).toBe(2);
    expect(vi.mocked(startJob).mock.calls.map((call) => (call[1] as { deliveryId: string }).deliveryId).sort()).toEqual([due.id, stuck.id].sort());
  });
});

describe("Send a test (E26-2)", () => {
  it("sends a sample at once, logs it, and says why it failed", async () => {
    const hook = await webhook();
    expect(await sendTest(hook.id, { now, fetchImpl: vi.fn(async () => new Response("", { status: 200 })) })).toEqual({ ok: true });
    expect(await sendTest(hook.id, { now, fetchImpl: vi.fn(async () => new Response("", { status: 401 })) })).toEqual({ ok: false, error: "The webhook refused it (401): check the token or address." });
    expect((await listDeliveries()).map((delivery) => [delivery.event, delivery.status])).toEqual([
      ["Send a test", "FAILED"],
      ["Send a test", "SENT"],
    ]);
  });
});
