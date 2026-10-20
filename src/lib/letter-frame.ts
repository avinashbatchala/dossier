import { DateFormat } from "@/generated/prisma/enums";
import { SIGN_OFF_UNIT, type Unit } from "@/lib/application-data";
import { ENGLISH_LABELS, type DocumentLabels } from "@/lib/document-labels";
import type { Basics } from "@/lib/profile";
import { contactItems } from "@/lib/resume-content";
import { formatDocumentDate } from "@/lib/settings";

// The parts of a cover letter around its paragraphs and sign-off (E8-11):
// the sender (name, then the contact line), the date, the recipient, the
// greeting and the name under the sign-off. Each is a unit, edited like the
// paragraphs. Letters written before E8-11 don't have them: they're drawn
// from the profile, in the letter's language, until one is edited.

export const FRAME_UNITS = ["sender", "date", "recipient", "greeting", "signature"] as const;
export type FrameUnitId = (typeof FRAME_UNITS)[number];
export type Frame = Record<FrameUnitId, string>;

export const FRAME_LABELS: Frame = { sender: "Sender", date: "Date", recipient: "Recipient", greeting: "Greeting", signature: "Signature" };

/** Parts with contact details: never sent to an AI model. */
export const PRIVATE_FRAME_UNITS: ReadonlySet<string> = new Set<FrameUnitId>(["sender", "signature"]);

/** Parts the AI writes, in the letter's language, and can write again. */
export const WRITTEN_FRAME_UNITS: ReadonlySet<string> = new Set<FrameUnitId>(["recipient", "greeting"]);

export const isFrameUnit = (id: string): id is FrameUnitId => (FRAME_UNITS as readonly string[]).includes(id);

/** A paragraph of the letter, as opposed to its frame or sign-off. */
export const isParagraph = (unit: Pick<Unit, "id">) => unit.id.startsWith("paragraph:");

/** The contact line as it's typed in the sender: items between " · ". */
export const SENDER_SEPARATOR = " · ";

type FrameContext = {
  basics: Basics;
  company: string;
  location: string;
  /** The letter's date, at UTC midnight. */
  date: Date;
  dateFormat: DateFormat;
  /** The words for the letter's language; English without them. */
  labels?: DocumentLabels;
};

/** The sender, signature, recipient, greeting and date from the profile and the application, in the labels' language. */
export function defaultFrame({ basics, company, location, date, dateFormat, labels = ENGLISH_LABELS }: FrameContext): Frame {
  const name = basics.name.trim() || "Your name";
  const to = company.trim();
  return {
    sender: [name, contactItems(basics, date, labels).join(SENDER_SEPARATOR)].filter(Boolean).join("\n"),
    date: letterDate(date, dateFormat, labels.locale),
    recipient: [to ? `${to} · ${labels.hiringTeam}` : labels.hiringTeam, location.trim()].filter(Boolean).join("\n"),
    greeting: labels.greeting(to),
    signature: name,
  };
}

/**
 * The date in the letter's language (a tag such as "de"): as the date format
 * setting says for English, the language's own long date otherwise
 * ("3. Oktober 2026"); numeric stays numeric.
 */
export function letterDate(date: Date, format: DateFormat, lang: string | undefined): string {
  if (!lang || /^en\b/i.test(lang) || format === DateFormat.NUMERIC) return formatDocumentDate(date, format, lang);
  try {
    return new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  } catch {
    return formatDocumentDate(date, format);
  }
}

/**
 * The frame of a new letter: the sender and signature from the profile, and
 * the date written once, in the letter's language. Its recipient and
 * greeting only stand in for ones the AI didn't write (withFrame keeps those).
 */
export function newFrame(context: FrameContext & { lang: string | undefined }): Frame {
  return { ...defaultFrame(context), date: letterDate(context.date, context.dateFormat, context.lang) };
}

/**
 * The letter's units in reading order, every part of the frame included:
 * the ones it has, and the rest from `frame` (those missing from both are
 * left out). Sender, date, recipient, greeting, paragraphs, sign-off,
 * signature.
 */
export function withFrame(units: Unit[], frame: Partial<Frame>): Unit[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const part = (id: FrameUnitId): Unit[] => {
    const unit = byId.get(id);
    if (unit) return [unit];
    const text = frame[id];
    return text === undefined ? [] : [{ id, label: FRAME_LABELS[id], text }];
  };
  const signOff = byId.get(SIGN_OFF_UNIT);
  return [
    ...part("sender"),
    ...part("date"),
    ...part("recipient"),
    ...part("greeting"),
    ...units.filter((unit) => !isFrameUnit(unit.id) && unit.id !== SIGN_OFF_UNIT),
    ...(signOff ? [signOff] : []),
    ...part("signature"),
  ];
}

/** The units without the parts that hold contact details, for AI prompts. */
export function withoutPrivateParts(units: Unit[]): Unit[] {
  return units.filter((unit) => !PRIVATE_FRAME_UNITS.has(unit.id));
}
