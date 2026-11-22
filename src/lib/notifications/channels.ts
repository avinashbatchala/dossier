import { z } from "zod";

import type { EventName } from "./events";

// Where notifications go (E26-2, #417): three types of channel, each with its
// settings and its one secret. Shared by the server and Settings → Notifications.

export const CHANNEL_TYPES = ["EMAIL", "WEBHOOK", "NTFY"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CHANNEL_INFO: Record<ChannelType, { label: string; hint: string; secret: string | null }> = {
  EMAIL: { label: "Email", hint: "A message to your inbox, sent through your mail provider's SMTP server.", secret: "Password" },
  WEBHOOK: { label: "Webhook", hint: "Each event as signed JSON to an address of yours, for n8n and the like.", secret: null },
  NTFY: { label: "ntfy", hint: "A push notification on your phone through ntfy, on ntfy.sh or your own server.", secret: "Access token" },
};

/** A channel with this many failed deliveries in a row is paused. */
export const PAUSE_AFTER_FAILURES = 10;

const text = (max: number) => z.string().trim().max(max);
const address = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), "Enter an address starting with http:// or https://.");
const email = z.string().trim().max(320).regex(/^[^\s@]+@[^\s@]+$/, "Enter an email address.");

const emailConfigSchema = z.object({
  host: text(253).min(1, "Enter the SMTP server."),
  port: z.coerce.number().int().min(1, "Enter the port.").max(65535),
  user: text(320),
  from: email,
  to: email,
});
const webhookConfigSchema = z.object({ url: address });
const ntfyConfigSchema = z.object({
  server: address,
  topic: z.string().trim().regex(/^[-_A-Za-z0-9]{1,64}$/, "A topic is up to 64 letters, digits, - and _."),
});

export type EmailConfig = z.infer<typeof emailConfigSchema>;
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
export type NtfyConfig = z.infer<typeof ntfyConfigSchema>;
export type ChannelConfig = EmailConfig | WebhookConfig | NtfyConfig;

export const configSchemas = { EMAIL: emailConfigSchema, WEBHOOK: webhookConfigSchema, NTFY: ntfyConfigSchema } as const;

const NTFY_PUBLIC_WARNING = "Anyone who knows this topic can read these messages. Use a hard-to-guess topic or an access token.";

/** The public-topic warning (N3): ntfy.sh without an access token. */
export function ntfyWarning(config: NtfyConfig, hasToken: boolean): string | null {
  const host = URL.canParse(config.server) ? new URL(config.server).hostname : "";
  return !hasToken && (host === "ntfy.sh" || host.endsWith(".ntfy.sh")) ? NTFY_PUBLIC_WARNING : null;
}

/** "smtp.example.com → me@example.com": a channel in a line. */
export function channelSummary(type: ChannelType, config: ChannelConfig): string {
  if (type === "EMAIL") return `${(config as EmailConfig).host} → ${(config as EmailConfig).to}`;
  if (type === "WEBHOOK") return (config as WebhookConfig).url;
  const { server, topic } = config as NtfyConfig;
  return `${server.replace(/\/+$/, "")}/${topic}`;
}

/** A channel as Settings shows it: never its secret. */
export type ChannelView = {
  id: string;
  type: ChannelType;
  name: string;
  config: ChannelConfig;
  summary: string;
  /** Each event on or off for it, its own choice or the default. */
  events: Record<EventName, boolean>;
  onlyNew: boolean;
  hasSecret: boolean;
  /** Paused after failed deliveries: when, and how many in a row. */
  pausedAt: string | null;
  failuresInARow: number;
  warning: string | null;
};

/** A delivery as the log shows it. */
export type DeliveryView = {
  id: string;
  at: string;
  /** "16 Nov, 09:30", in the user's time zone. */
  when: string;
  event: string;
  channel: string;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED";
  error: string | null;
  attempts: number;
};
