import type { Unit } from "@/lib/application-data";

// The email that goes with an application, on its Email tab: who it's to,
// its subject and its text. They're the units of the application's EMAIL
// document, so they're edited, rewritten, refined from the chat and kept in
// the history like the resume's and the letter's parts.

export const EMAIL_UNITS = ["to", "subject", "body"] as const;
type EmailUnitId = (typeof EMAIL_UNITS)[number];

/** The units' labels, as the toolbar, the chat ("About: Subject") and the history name them. */
const EMAIL_LABELS: Record<EmailUnitId, string> = { to: "Recipient", subject: "Subject", body: "Message" };

/** The parts the AI writes and can write again; the recipient comes from the posting or the user. */
export const WRITTEN_EMAIL_UNITS: ReadonlySet<string> = new Set<EmailUnitId>(["subject", "body"]);

export type EmailParts = Record<EmailUnitId, string>;

/** The email's texts by part; a missing part is empty. */
export function emailParts(units: Unit[]): EmailParts {
  const text = (id: EmailUnitId) => units.find((unit) => unit.id === id)?.text ?? "";
  return { to: text("to"), subject: text("subject"), body: text("body") };
}

/** The units of an email, in order. */
export function emailUnits(parts: EmailParts): Unit[] {
  return EMAIL_UNITS.map((id) => ({ id, label: EMAIL_LABELS[id], text: parts[id] }));
}

// At most 64 characters before the @ and 253 after (RFC 5321), and no second @,
// which also keeps a long posting quick to search.
const ADDRESS = /[^\s<>()[\],;:"'@]{1,64}@[^\s<>()[\],;:"'@]{1,253}\.[^\s<>()[\],;:"'.@]{1,63}/g;

/** Whether `text` is one email address and nothing else. */
export function isEmailAddress(text: string): boolean {
  return new RegExp(`^${ADDRESS.source}$`).test(text);
}

/** The addresses in a recipient line, e.g. ["john@example.com"] from "John Doe <john@example.com>". */
export function emailAddresses(text: string): string[] {
  return [...new Set(text.match(ADDRESS) ?? [])];
}

/**
 * A mailto: link that opens the mail app with the email filled in (RFC
 * 6068): addresses only, without names, and line breaks as CRLF. Mail apps
 * can't take attachments this way.
 */
export function mailtoHref({ to, subject, body }: EmailParts): string {
  const encode = (value: string) => encodeURIComponent(value.replace(/\r?\n/g, "\r\n"));
  const addresses = emailAddresses(to).map((address) => encodeURIComponent(address).replace(/%40/g, "@"));
  const fields = [subject.trim() && `subject=${encode(subject.trim())}`, body.trim() && `body=${encode(body.trim())}`].filter(Boolean);
  return `mailto:${addresses.join(",")}${fields.length > 0 ? `?${fields.join("&")}` : ""}`;
}
