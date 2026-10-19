import { randomBytes } from "node:crypto";

// Building and reading email messages (RFC 5322, MIME) for Gmail (E15-2,
// E15-3). Only what Dossier sends and reads: a plain text body with PDF
// attachments, and the text of replies.

export type Attachment = { fileName: string; contentType: string; data: Uint8Array };

export type OutgoingMail = {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
  /** The Message-ID being answered, to reply in its thread. */
  inReplyTo?: string;
  /** The thread's earlier Message-IDs. */
  references?: string;
};

/** A header value in RFC 2047 encoded words when it isn't plain ASCII. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** "Name <a@b>" with the name encoded, or the address alone. */
export function encodeAddress(value: string): string {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return value.replace(/[\r\n]+/g, " ").trim();
  const [, name, address] = match;
  return name.trim() ? `${encodeHeader(name.trim())} <${address.trim()}>` : address.trim();
}

/** Base64 in lines of 76, as MIME wants. */
function wrapped(data: Uint8Array | string): string {
  const base64 = Buffer.from(data).toString("base64");
  return base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** A file name for Content-Disposition (RFC 2231 for anything not ASCII). */
function fileNameParameter(name: string): string {
  const safe = name.replace(/["\\\r\n]/g, "_");
  if (/^[\x20-\x7e]*$/.test(safe)) return `filename="${safe}"`;
  return `filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The whole message, ready for Gmail's `raw` field after base64url. */
export function buildMessage(mail: OutgoingMail, { boundary = `dossier-${randomBytes(12).toString("hex")}`, date = new Date() } = {}): string {
  const headers = [
    `From: ${encodeAddress(mail.from)}`,
    `To: ${mail.to.split(/[,;]/).map(encodeAddress).filter(Boolean).join(", ")}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    "MIME-Version: 1.0",
    ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`, `References: ${[mail.references, mail.inReplyTo].filter(Boolean).join(" ")}`] : []),
  ];
  const text = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrapped(mail.body.replace(/\r?\n/g, "\r\n"))].join("\r\n");
  const attachments = mail.attachments ?? [];
  if (attachments.length === 0) return [...headers, text].join("\r\n");

  const parts = [
    text,
    ...attachments.map((file) =>
      [
        `Content-Type: ${file.contentType}; name="${file.fileName.replace(/["\\\r\n]/g, "_")}"`,
        `Content-Disposition: attachment; ${fileNameParameter(file.fileName)}`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapped(file.data),
      ].join("\r\n"),
    ),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((part) => `--${boundary}\r\n${part}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** base64url, as Gmail's API wants message bodies. */
export const toBase64Url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

/** "Jane Doe <jane@example.com>" → its parts. */
export function parseAddress(value: string): { name: string; address: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (match) return { name: decodeHeader(match[1].trim()), address: match[2].trim().toLowerCase() };
  return { name: "", address: value.trim().toLowerCase() };
}

/** RFC 2047 encoded words back to text. */
export function decodeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, charset: string, encoding: string, text: string) => {
    try {
      const bytes =
        encoding.toLowerCase() === "b"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return text;
    }
  });
}

/** The domain of an address, lowercased: "jobs.example.com". */
export function domainOf(address: string): string {
  return address.split("@")[1]?.trim().toLowerCase() ?? "";
}

/** Domains where anyone can have an address, so they don't tell a company apart. */
export const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com",
  "gmx.de", "gmx.net", "web.de", "proton.me", "protonmail.com", "aol.com", "mail.com", "t-online.de",
]);

/**
 * The reply's own words: quoted lines and everything after "On … wrote:"
 * (or a forwarded or original-message marker) go.
 */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*(On .+wrote:|Am .+schrieb.+:|Le .+a écrit\s*:|-{2,}\s*Original Message\s*-{2,}|-{5,}\s*Forwarded message)/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && kept.some((entry) => entry.trim())) break;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** HTML mail as plain text, for when there's no text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
