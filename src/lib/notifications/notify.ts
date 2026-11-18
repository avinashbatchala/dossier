import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { NotificationDeliveryStatus } from "@/generated/prisma/enums";
import { isDesktopApp } from "@/lib/desktop";
import { env } from "@/lib/env";
import { defineJob, findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { decryptSecret, NOTIFICATION_SECRET, SecretUnreadable } from "@/lib/secrets";
import { loadSettings } from "@/lib/settings-data";

import { PAUSE_AFTER_FAILURES, type ChannelType } from "./channels";
import { EVENTS, eventOn, testMessage, type EventData, type EventName, type NotificationMessage } from "./events";
import { SendError, sendMessage, type OutgoingMessage } from "./send";

// Delivering notifications (E26-1, #416). Code that sees an event calls
// emit(<name>, data): Dossier builds the message once, finds the channels
// that want it and queues one delivery each in the job runner, beside the
// AI jobs, so a slow or unreachable target never holds anything up. A failed
// delivery is tried 3 more times, after 1, 5 and 30 minutes, then marked
// failed; a channel with 10 failed deliveries in a row is paused. A timer
// every minute sends the deliveries that are due. Like the other timers, it's
// only safe with a single instance of the app.

/** Minutes before the second, third and fourth try. */
const RETRY_MINUTES = [1, 5, 30] as const;
/** The delivery log keeps the newest this many; it shows the latest 50. */
const KEEP_DELIVERIES = 200;
const MINUTE_MS = 60_000;

/** Where links point (N1): DOSSIER_PUBLIC_URL, else the address Dossier was last opened at; none on the desktop app's "On this computer". */
async function linkBase(): Promise<string | null> {
  if (isDesktopApp()) return null;
  const base = env.DOSSIER_PUBLIC_URL ?? (await loadSettings()).lastOrigin;
  return base ? base.replace(/\/+$/, "") : null;
}

/** A message ready to send, its link made absolute. */
function outgoing(event: string, message: NotificationMessage, data: unknown, base: string | null, now: Date): OutgoingMessage {
  const link = message.url ?? (message.path && base ? `${base}${message.path}` : null);
  return { event, title: message.title, text: message.text, link, at: now.toISOString(), data };
}

const storedMessage = z.object({ event: z.string(), title: z.string(), text: z.string(), link: z.string().nullable(), at: z.string(), data: z.unknown() });

/** A channel's secret, or null for none or one that can't be read (DOSSIER_SECRET changed). */
function secretOf(secretEnc: string | null): string | null {
  if (!secretEnc) return null;
  try {
    return decryptSecret(NOTIFICATION_SECRET, secretEnc);
  } catch (error) {
    if (error instanceof SecretUnreadable) return null;
    throw error;
  }
}

const channelEvents = (value: Prisma.JsonValue) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, boolean>) : {});

/** Queues one delivery's job, unless one is already queued or running. */
async function queue(deliveryId: string): Promise<void> {
  const key = `notification:${deliveryId}`;
  if ((await findUnfinishedJobs(key)).length > 0) return;
  await startJob(deliverNotificationJob, { deliveryId }, { key });
}

/** Whether any channel would hear of an event now, e.g. to say "I'll let you know" only when it's true. */
export async function anyChannelFor(name: EventName): Promise<boolean> {
  const channels = await prisma.notificationChannel.findMany({ where: { pausedAt: null }, select: { events: true } });
  return channels.some((channel) => eventOn(channelEvents(channel.events), name));
}

/**
 * An event happened: one delivery for each channel that wants it, queued at
 * once. Returns how many. Never fails the caller: a problem is logged.
 */
export async function emit<N extends EventName>(name: N, data: EventData[N], now = new Date()): Promise<number> {
  try {
    const definition = EVENTS[name];
    const channels = (await prisma.notificationChannel.findMany({ where: { pausedAt: null }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] })).filter(
      (channel) => eventOn(channelEvents(channel.events), name) && !(channel.onlyNew && definition.hasNews && !definition.hasNews(data)),
    );
    if (channels.length === 0) return 0;
    const message = outgoing(name, definition.message(data), data, await linkBase(), now);
    for (const channel of channels) {
      const delivery = await prisma.notificationDelivery.create({ data: { channelId: channel.id, event: name, message: message as Prisma.InputJsonValue, nextAt: now }, select: { id: true } });
      await queue(delivery.id);
    }
    return channels.length;
  } catch (error) {
    logServerError("notifications", error);
    return 0;
  }
}

/** A failure as a reason for the log: a SendError's own words, else something general. */
const reasonOf = (error: unknown) => (error instanceof SendError ? error.message : "It couldn't be sent.");

/**
 * One try at a delivery: sent, or tried again later, or failed after its
 * last try. Counts the channel's failures in a row, and pauses it at 10.
 */
export async function attemptDelivery(deliveryId: string, { now = new Date(), fetchImpl = fetch }: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<NotificationDeliveryStatus | null> {
  const delivery = await prisma.notificationDelivery.findUnique({ where: { id: deliveryId }, include: { channel: true } });
  if (!delivery || delivery.status === NotificationDeliveryStatus.SENT || delivery.status === NotificationDeliveryStatus.FAILED) return delivery?.status ?? null;
  const { channel } = delivery;
  const attempts = delivery.attempts + 1;
  await prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: NotificationDeliveryStatus.SENDING, attempts } });
  try {
    if (channel.pausedAt) throw new SendError("The channel is paused.");
    const message = storedMessage.parse(delivery.message);
    await sendMessage({ type: channel.type as ChannelType, name: channel.name, config: channel.config, secret: secretOf(channel.secretEnc) }, message, { fetchImpl, now });
    await prisma.$transaction([
      prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: NotificationDeliveryStatus.SENT, sentAt: now, error: null } }),
      prisma.notificationChannel.update({ where: { id: channel.id }, data: { failuresInARow: 0 } }),
    ]);
    return NotificationDeliveryStatus.SENT;
  } catch (error) {
    if (!(error instanceof SendError)) logServerError("notifications", error);
    const error_ = reasonOf(error);
    const retry = RETRY_MINUTES[attempts - 1];
    if (retry !== undefined && !channel.pausedAt) {
      await prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: NotificationDeliveryStatus.PENDING, error: error_, nextAt: new Date(now.getTime() + retry * MINUTE_MS) } });
      return NotificationDeliveryStatus.PENDING;
    }
    const failures = channel.failuresInARow + 1;
    await prisma.$transaction([
      prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: NotificationDeliveryStatus.FAILED, error: error_ } }),
      prisma.notificationChannel.update({ where: { id: channel.id }, data: { failuresInARow: failures, ...(failures >= PAUSE_AFTER_FAILURES && !channel.pausedAt ? { pausedAt: now } : {}) } }),
    ]);
    return NotificationDeliveryStatus.FAILED;
  }
}

/** One delivery's try, in the job runner beside the AI jobs. */
const deliverNotificationJob = defineJob({
  type: "notification-delivery",
  input: z.object({ deliveryId: z.string().min(1) }),
  result: z.object({ status: z.string().nullable() }),
  beside: true,
  async run({ deliveryId }) {
    return { status: await attemptDelivery(deliveryId) };
  },
});

/** Send a test (E26-2): a sample message at once, logged, and why it failed if it did. */
export async function sendTest(channelId: string, { now = new Date(), fetchImpl = fetch }: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const channel = await prisma.notificationChannel.findUniqueOrThrow({ where: { id: channelId } });
  const message = outgoing("test", testMessage(channel.name), { test: true }, await linkBase(), now);
  try {
    await sendMessage({ type: channel.type as ChannelType, name: channel.name, config: channel.config, secret: secretOf(channel.secretEnc) }, message, { fetchImpl, now });
    await prisma.notificationDelivery.create({ data: { channelId, event: "test", message: message as Prisma.InputJsonValue, status: NotificationDeliveryStatus.SENT, attempts: 1, sentAt: now } });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof SendError)) logServerError("notifications", error);
    const reason = reasonOf(error);
    await prisma.notificationDelivery.create({ data: { channelId, event: "test", message: message as Prisma.InputJsonValue, status: NotificationDeliveryStatus.FAILED, attempts: 1, error: reason } });
    return { ok: false, error: reason };
  }
}

/** Every minute: queues the deliveries that are due, picks up ones a restart left half-done, and keeps the log short. */
export async function sendDueDeliveries(now = new Date()): Promise<number> {
  // A try that was under way when the server stopped: due again.
  await prisma.notificationDelivery.updateMany({
    where: { status: NotificationDeliveryStatus.SENDING, updatedAt: { lt: new Date(now.getTime() - 10 * MINUTE_MS) } },
    data: { status: NotificationDeliveryStatus.PENDING, nextAt: now },
  });
  const due = await prisma.notificationDelivery.findMany({ where: { status: NotificationDeliveryStatus.PENDING, nextAt: { lte: now } }, select: { id: true }, take: 100 });
  for (const { id } of due) await queue(id);
  const old = await prisma.notificationDelivery.findMany({ orderBy: { createdAt: "desc" }, skip: KEEP_DELIVERIES, select: { id: true } });
  if (old.length > 0) await prisma.notificationDelivery.deleteMany({ where: { id: { in: old.map((row) => row.id) }, status: { in: [NotificationDeliveryStatus.SENT, NotificationDeliveryStatus.FAILED] } } });
  return due.length;
}

const globalForNotifications = globalThis as unknown as { notificationTimer?: ReturnType<typeof setInterval> };

/** Starts the minute timer, once per process (dev reloads keep the one they have). */
export function startNotificationSchedule(): void {
  if (globalForNotifications.notificationTimer) return;
  globalForNotifications.notificationTimer = setInterval(() => {
    void sendDueDeliveries().catch((error: unknown) => logServerError("notifications", error));
  }, MINUTE_MS);
  globalForNotifications.notificationTimer.unref?.();
}
