import "server-only";

import { z } from "zod";

import { googleFetch } from "./account";
import { googleUrl } from "./endpoints";
import { buildMessage, decodeHeader, htmlToText, toBase64Url, type OutgoingMail } from "./mime";

// The parts of the Gmail API Dossier uses (E15-2, E15-3).

const api = (path: string) => googleUrl("gmail", `/gmail/v1/users/me${path}`);

/** Sends a message; with `threadId` it joins that thread. */
export async function sendMail(mail: OutgoingMail, { threadId }: { threadId?: string } = {}): Promise<{ id: string; threadId: string }> {
  const raw = toBase64Url(buildMessage(mail));
  const sent = await googleFetch<{ id: string; threadId: string }>("send", api("/messages/send"), {
    method: "POST",
    body: threadId ? { raw, threadId } : { raw },
  });
  return { id: sent.id, threadId: sent.threadId };
}

const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().default(""),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional(), size: z.number().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);
type GmailPart = {
  mimeType: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  internalDate: z.string().optional(),
  snippet: z.string().default(""),
  payload: partSchema,
});

/** A Gmail message as Dossier reads it. */
export type ReadMail = {
  id: string;
  threadId: string;
  labels: string[];
  from: string;
  to: string;
  subject: string;
  messageId: string;
  references: string;
  date: Date;
  /** The text body; from HTML when there's no text part. */
  text: string;
};

const header = (part: GmailPart, name: string) =>
  part.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** The first part of `type`, depth first, skipping attachments. */
function findPart(part: GmailPart, type: string): GmailPart | null {
  if (part.mimeType === type && !part.filename && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, type);
    if (found) return found;
  }
  return null;
}

const decodeBody = (data: string) => Buffer.from(data, "base64url").toString("utf8");

/** A message from the API's answer. */
export function readMessage(json: unknown): ReadMail {
  const message = messageSchema.parse(json);
  const { payload } = message;
  const plain = findPart(payload, "text/plain");
  const html = plain ? null : findPart(payload, "text/html");
  const text = plain ? decodeBody(plain.body!.data!) : html ? htmlToText(decodeBody(html.body!.data!)) : message.snippet;
  const dateHeader = header(payload, "Date");
  const date = message.internalDate ? new Date(Number(message.internalDate)) : new Date(dateHeader);
  return {
    id: message.id,
    threadId: message.threadId,
    labels: message.labelIds,
    from: decodeHeader(header(payload, "From")),
    to: decodeHeader(header(payload, "To")),
    subject: decodeHeader(header(payload, "Subject")),
    messageId: header(payload, "Message-ID") || header(payload, "Message-Id"),
    references: header(payload, "References"),
    date: Number.isNaN(date.getTime()) ? new Date() : date,
    text,
  };
}

export async function getMessage(id: string, signal?: AbortSignal): Promise<ReadMail> {
  return readMessage(await googleFetch("read", api(`/messages/${encodeURIComponent(id)}?format=full`), { signal }));
}

/** Where the mailbox is now, to check from next time. */
export async function currentHistoryId(signal?: AbortSignal): Promise<string> {
  const profile = await googleFetch<{ historyId: string }>("read", api("/profile"), { signal });
  return profile.historyId;
}

/**
 * The ids of messages added since `historyId`, and where to carry on from.
 * Null when Gmail has forgotten that far back (it keeps about a week): then
 * the caller starts over from a search.
 */
export async function messagesSince(historyId: string, signal?: AbortSignal): Promise<{ ids: string[]; historyId: string } | null> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latest = historyId;
  do {
    const url = new URL(api("/history"));
    url.searchParams.set("startHistoryId", historyId);
    url.searchParams.set("historyTypes", "messageAdded");
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    let page: { history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string; historyId: string };
    try {
      page = await googleFetch("read", url, { signal });
    } catch (error) {
      if (error instanceof Error && "detail" in error && String((error as { detail?: string }).detail).endsWith("404")) return null;
      throw error;
    }
    for (const entry of page.history ?? []) for (const added of entry.messagesAdded ?? []) ids.add(added.message.id);
    latest = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], historyId: latest };
}

/** Message ids matching a Gmail search, newest first, up to `max`. */
export async function searchMessages(query: string, { max = 100, signal }: { max?: number; signal?: AbortSignal } = {}): Promise<string[]> {
  const url = new URL(api("/messages"));
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(Math.min(max, 500)));
  const page = await googleFetch<{ messages?: { id: string }[] }>("read", url, { signal });
  return (page.messages ?? []).map((message) => message.id);
}
