import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, NOTIFICATION_SECRET, SecretUnreadable } from "@/lib/secrets";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { channelSummary, configSchemas, ntfyWarning, type ChannelConfig, type ChannelType, type ChannelView, type DeliveryView, type NtfyConfig } from "./channels";
import { EVENT_NAMES, EVENTS, eventOn, type EventName } from "./events";

// Settings → Notifications' channels (E26-2) and grid (E26-3): what the
// screen shows, never a secret but the webhook's when asked to copy it.

type Row = Prisma.NotificationChannelGetPayload<object>;

const eventsOf = (value: Prisma.JsonValue): Record<string, boolean> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, boolean>) : {});

/** A new webhook's signing secret: 32 random bytes. */
export const newWebhookSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

function view(row: Row): ChannelView {
  const type = row.type as ChannelType;
  const config = configSchemas[type].safeParse(row.config);
  const settled = (config.success ? config.data : row.config) as ChannelConfig;
  const own = eventsOf(row.events);
  return {
    id: row.id,
    type,
    name: row.name,
    config: settled,
    summary: config.success ? channelSummary(type, settled) : "",
    events: Object.fromEntries(EVENT_NAMES.map((name) => [name, eventOn(own, name)])) as Record<EventName, boolean>,
    onlyNew: row.onlyNew,
    hasSecret: row.secretEnc !== null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    failuresInARow: row.failuresInARow,
    warning: type === "NTFY" && config.success ? ntfyWarning(settled as NtfyConfig, row.secretEnc !== null) : null,
  };
}

export async function listChannels(): Promise<ChannelView[]> {
  return (await prisma.notificationChannel.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] })).map(view);
}

/** The latest 50 deliveries, newest first, for the log. */
export async function listDeliveries(): Promise<DeliveryView[]> {
  const [rows, timeZone] = await Promise.all([
    prisma.notificationDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { channel: { select: { name: true } } } }),
    lastKnownTimeZone(),
  ]);
  const format = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
  return rows.map((row) => ({
    id: row.id,
    at: (row.sentAt ?? row.updatedAt).toISOString(),
    when: format.format(row.sentAt ?? row.updatedAt),
    event: row.event === "test" ? "Send a test" : (EVENTS[row.event as EventName]?.label ?? row.event),
    channel: row.channel.name,
    status: row.status,
    error: row.error,
    attempts: row.attempts,
  }));
}

/** The secret change a form sends: keep it, set a new one, or remove it. */
export type SecretChange = { action: "keep" } | { action: "set"; value: string } | { action: "clear" };

/**
 * Adds a channel, or changes one; returns its view. A new webhook gets its
 * signing secret here. Each event starts at its default.
 */
export async function saveChannel(input: { id?: string; type: ChannelType; name: string; config: ChannelConfig; secret: SecretChange }): Promise<ChannelView> {
  const config = configSchemas[input.type].parse(input.config) as Prisma.InputJsonValue;
  const secretEnc =
    input.secret.action === "set"
      ? encryptSecret(NOTIFICATION_SECRET, input.secret.value)
      : input.secret.action === "clear"
        ? null
        : undefined;
  if (input.id) {
    const row = await prisma.notificationChannel.update({ where: { id: input.id }, data: { name: input.name, config, ...(secretEnc === undefined ? {} : { secretEnc }) } });
    return view(row);
  }
  const sort = ((await prisma.notificationChannel.aggregate({ _max: { sort: true } }))._max.sort ?? -1) + 1;
  const row = await prisma.notificationChannel.create({
    data: {
      type: input.type,
      name: input.name,
      config,
      sort,
      secretEnc: input.type === "WEBHOOK" ? encryptSecret(NOTIFICATION_SECRET, newWebhookSecret()) : (secretEnc ?? null),
    },
  });
  return view(row);
}

export async function deleteChannel(id: string): Promise<void> {
  await prisma.notificationChannel.deleteMany({ where: { id } });
}

/** One cell of the grid. */
export async function setChannelEvent(id: string, event: EventName, on: boolean): Promise<ChannelView> {
  const row = await prisma.notificationChannel.findUniqueOrThrow({ where: { id } });
  return view(await prisma.notificationChannel.update({ where: { id }, data: { events: { ...eventsOf(row.events), [event]: on } } }));
}

export async function setOnlyNew(id: string, onlyNew: boolean): Promise<ChannelView> {
  return view(await prisma.notificationChannel.update({ where: { id }, data: { onlyNew } }));
}

/** Resume a paused channel: its count of failures starts again. */
export async function resumeChannel(id: string): Promise<ChannelView> {
  return view(await prisma.notificationChannel.update({ where: { id }, data: { pausedAt: null, failuresInARow: 0 } }));
}

/** The webhook's signing secret, to copy; null when it can't be read (DOSSIER_SECRET changed). */
export async function webhookSecret(id: string): Promise<string | null> {
  const row = await prisma.notificationChannel.findUniqueOrThrow({ where: { id } });
  if (row.type !== "WEBHOOK" || !row.secretEnc) return null;
  try {
    return decryptSecret(NOTIFICATION_SECRET, row.secretEnc);
  } catch (error) {
    if (error instanceof SecretUnreadable) return null;
    throw error;
  }
}

/** A new signing secret for a webhook; the old one stops working at once. */
export async function regenerateWebhookSecret(id: string): Promise<string> {
  const secret = newWebhookSecret();
  await prisma.notificationChannel.update({ where: { id, type: "WEBHOOK" }, data: { secretEnc: encryptSecret(NOTIFICATION_SECRET, secret) } });
  return secret;
}
