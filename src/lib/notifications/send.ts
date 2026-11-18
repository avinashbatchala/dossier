import "server-only";

import { createHmac } from "node:crypto";

import nodemailer from "nodemailer";

import { appVersion } from "@/lib/version";

import type { ChannelType, EmailConfig, NtfyConfig, WebhookConfig } from "./channels";

// Sending one message to one channel (E26-2, #417): each type formats the
// same event its own way. An email has a subject, the text and the link; a
// webhook gets the whole event as JSON, signed with the channel's secret; ntfy
// gets the title, the text and the link as its tap action. Addresses on the
// local network are allowed: these are targets the user set, such as a
// self-hosted ntfy or n8n.

/** A message ready to send: the link made absolute, or null where there's none. */
export type OutgoingMessage = { event: string; title: string; text: string; link: string | null; at: string; data: unknown };

export type SendableChannel = { type: ChannelType; name: string; config: unknown; secret: string | null };

const TIMEOUT_MS = 15_000;

/** A failure, in words for the delivery log; never the target's whole answer. */
export class SendError extends Error {}

/**
 * The webhook signature (decided 16 November, Stripe-style):
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, with the channel's secret.
 */
export function webhookSignature(secret: string, body: string, seconds: number): string {
  return `t=${seconds},v1=${createHmac("sha256", secret).update(`${seconds}.${body}`).digest("hex")}`;
}

/** The body a webhook gets: the event, its message and its data. */
const webhookBody = (message: OutgoingMessage) => JSON.stringify({ event: message.event, title: message.title, text: message.text, link: message.link, at: message.at, data: message.data });

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** An HTTP answer that isn't a success, as a reason for the log; `what` is "the webhook" or "the ntfy server". */
async function httpFailure(response: Response, what: string): Promise<SendError> {
  const who = capital(what);
  await response.body?.cancel().catch(() => {});
  if (response.status === 401 || response.status === 403) return new SendError(`${who} refused it (${response.status}): check the token or address.`);
  if (response.status === 404) return new SendError(`${who} answered 404: check the address.`);
  if (response.status === 429) return new SendError(`${who} is limiting messages (429).`);
  return new SendError(`${who} answered ${response.status}.`);
}

async function post(url: string, init: RequestInit, what: string, fetchImpl: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new SendError(name === "TimeoutError" ? `${capital(what)} didn't answer within 15 seconds.` : `Couldn't reach ${what}: check the address, and that the server can reach it.`);
  }
  if (!response.ok) throw await httpFailure(response, what);
  await response.body?.cancel().catch(() => {});
}

async function sendEmail(config: EmailConfig, password: string | null, message: OutgoingMessage): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 speaks TLS from the start; other ports upgrade with STARTTLS when the server offers it.
    secure: config.port === 465,
    auth: config.user ? { user: config.user, pass: password ?? "" } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    await transport.sendMail({
      from: config.from,
      to: config.to,
      subject: message.title,
      text: message.link ? `${message.text}\n\n${message.link}` : message.text,
      headers: { "X-Dossier-Event": message.event },
    });
  } catch (error) {
    const code = (error as { code?: string; responseCode?: number }).code;
    const responseCode = (error as { responseCode?: number }).responseCode;
    if (code === "EAUTH" || responseCode === 535) throw new SendError("The SMTP server didn't accept the user and password.");
    if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || code === "EDNS") throw new SendError("Couldn't reach the SMTP server: check its name and port.");
    if (code === "EENVELOPE") throw new SendError("The SMTP server refused the from or to address.");
    throw new SendError(`The SMTP server refused the message${responseCode ? ` (${responseCode})` : ""}.`);
  } finally {
    transport.close();
  }
}

/** Sends `message` to `channel`; fails as a SendError with the reason. */
export async function sendMessage(channel: SendableChannel, message: OutgoingMessage, { fetchImpl = fetch, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<void> {
  if (channel.type === "EMAIL") return sendEmail(channel.config as EmailConfig, channel.secret, message);
  if (channel.type === "WEBHOOK") {
    const body = webhookBody(message);
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": `Dossier/${appVersion}`, "x-dossier-event": message.event };
    if (channel.secret) headers["x-dossier-signature"] = webhookSignature(channel.secret, body, Math.floor(now.getTime() / 1000));
    return post((channel.config as WebhookConfig).url, { headers, body }, "the webhook", fetchImpl);
  }
  // ntfy's JSON publishing, to the server's root, keeps titles in any language intact.
  const { server, topic } = channel.config as NtfyConfig;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (channel.secret) headers.authorization = `Bearer ${channel.secret}`;
  return post(
    server.replace(/\/+$/, "") + "/",
    { headers, body: JSON.stringify({ topic, title: message.title, message: message.text, ...(message.link ? { click: message.link } : {}) }) },
    "the ntfy server",
    fetchImpl,
  );
}
