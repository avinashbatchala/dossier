"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { CHANNEL_TYPES, configSchemas } from "@/lib/notifications/channels";
import { EVENT_NAMES } from "@/lib/notifications/events";
import { sendTest } from "@/lib/notifications/notify";
import { deleteChannel, listDeliveries, regenerateWebhookSecret, resumeChannel, saveChannel, setChannelEvent, setOnlyNew, webhookSecret } from "@/lib/notifications/store";

// Settings → Notifications (E26, #416–#418): channels, the grid and the
// delivery log. Each returns what the section shows, never a secret but the
// webhook's when the user asks to copy it.

const id = z.string().min(1).max(100);

/** Adds a channel, or changes one; its settings are checked by its type. */
export const saveNotificationChannel = action(
  z.object({
    id: id.optional(),
    type: z.enum(CHANNEL_TYPES),
    name: z.string().trim().min(1, "Give the channel a name.").max(60),
    config: z.unknown(),
    secret: z.discriminatedUnion("action", [
      z.object({ action: z.literal("keep") }),
      z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("clear") }),
    ]),
  }),
  async ({ id: channelId, type, name, config, secret }) => {
    const parsed = configSchemas[type].safeParse(config);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0].message);
    if (type === "WEBHOOK" && secret.action !== "keep") throw new ActionError("A webhook's secret is made by Dossier: regenerate it instead.");
    return saveChannel({ id: channelId, type, name, config: parsed.data, secret });
  },
);

export const deleteNotificationChannel = action(z.object({ id }), async ({ id: channelId }) => {
  await deleteChannel(channelId);
  return null;
});

/** One cell of the grid (E26-3). */
export const setNotificationEvent = action(z.object({ id, event: z.enum(EVENT_NAMES as [string, ...string[]]), on: z.boolean() }), async ({ id: channelId, event, on }) =>
  setChannelEvent(channelId, event as (typeof EVENT_NAMES)[number], on),
);

/** "Only when there's something new" (N2). */
export const setNotificationOnlyNew = action(z.object({ id, onlyNew: z.boolean() }), async ({ id: channelId, onlyNew }) => setOnlyNew(channelId, onlyNew));

export const resumeNotificationChannel = action(z.object({ id }), async ({ id: channelId }) => resumeChannel(channelId));

/** Send a test (E26-2): a sample message at once, and why it failed if it did; then the log as it is. */
export const testNotificationChannel = action(z.object({ id }), async ({ id: channelId }) => ({ result: await sendTest(channelId), log: await listDeliveries() }));

/** The webhook's signing secret, to copy. */
export const copyWebhookSecret = action(z.object({ id }), async ({ id: channelId }) => {
  const secret = await webhookSecret(channelId);
  if (!secret) throw new ActionError("The secret can't be read: DOSSIER_SECRET changed. Regenerate it.");
  return secret;
});

/** A new signing secret; the old one stops working at once. */
export const regenerateNotificationSecret = action(z.object({ id }), async ({ id: channelId }) => regenerateWebhookSecret(channelId));
