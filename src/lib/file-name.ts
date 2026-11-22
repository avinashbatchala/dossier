import { DocumentKind } from "@/generated/prisma/enums";

// File names for downloaded PDFs (SET-8), from the pattern in Settings.

/** The tokens a pattern can use, with what they stand for (Settings shows these). */
export const FILE_NAME_TOKENS = [
  { token: "{name}", description: "Your full name" },
  { token: "{first}", description: "First name" },
  { token: "{company}", description: "Company" },
  { token: "{role}", description: "Job title" },
  { token: "{doc}", description: "Resume or Cover letter" },
  { token: "{date}", description: "Download date" },
] as const;

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  [DocumentKind.RESUME]: "Resume",
  [DocumentKind.COVER_LETTER]: "Cover letter",
  // Never a file, but named like the others (the history, toasts).
  [DocumentKind.EMAIL]: "Email",
};

export type FileNameContext = {
  name: string;
  /** Empty for the base resume. */
  company?: string;
  role?: string;
  doc: DocumentKind;
  /** The download date; `{date}` is its calendar day on the server, YYYY-MM-DD. */
  date: Date;
};

/** Longer names are cut to this many characters, which leaves room for ".pdf" on any file system. */
const MAX_FILE_NAME_LENGTH = 120;

// Not allowed in file names on Windows, macOS or Linux, plus control characters.
const INVALID = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
/** Text between tokens that only separates them, e.g. " – " or "_". */
const SEPARATOR = /^[\s\-\u2013\u2014_·,.]+$/;
const DANGLING = /^[\s\-\u2013\u2014_·,.]+|[\s\-\u2013\u2014_·,.]+$/g;
// Reserved device names on Windows, whatever the extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

const pad = (value: number) => String(value).padStart(2, "0");

const cleanUp = (text: string) => text.replace(INVALID, " ").replace(/\s+/g, " ").replace(DANGLING, "");

/**
 * "{name} – {company} – {doc}" → "Jane Doe – Ledgerly – Resume.pdf".
 * Unknown tokens stay as typed; a token without a value takes one of its
 * separators with it, so the base resume gives "Jane Doe – Resume.pdf".
 */
export function resolveFileName(pattern: string, context: FileNameContext): string {
  const name = context.name.trim();
  const values: Record<string, string> = {
    "{name}": name,
    "{first}": name.split(/\s+/)[0],
    "{company}": context.company?.trim() ?? "",
    "{role}": context.role?.trim() ?? "",
    "{doc}": DOCUMENT_LABELS[context.doc],
    "{date}": `${context.date.getFullYear()}-${pad(context.date.getMonth() + 1)}-${pad(context.date.getDate())}`,
  };

  // Literal text at even indexes, tokens at odd ones.
  const parts = pattern.split(/(\{[a-z]+\})/);
  for (let index = 1; index < parts.length; index += 2) {
    const value = values[parts[index]] ?? parts[index];
    parts[index] = value;
    if (value) continue;
    if (SEPARATOR.test(parts[index + 1])) parts[index + 1] = "";
    else if (SEPARATOR.test(parts[index - 1])) parts[index - 1] = "";
  }

  let base = cleanUp(parts.join(""));
  const characters = Array.from(base);
  if (characters.length > MAX_FILE_NAME_LENGTH) {
    // Cut at the last word boundary, unless that loses too much.
    const cut = characters.slice(0, MAX_FILE_NAME_LENGTH).join("");
    const space = cut.lastIndexOf(" ");
    base = cleanUp(space > cut.length / 2 ? cut.slice(0, space) : cut);
  }
  if (!base) base = "untitled";
  if (RESERVED.test(base)) base = `${base}_`;
  return `${base}.pdf`;
}

/** Percent-encodes for RFC 5987, which also reserves ' ( ) and *. */
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * A Content-Disposition header for downloading `fileName`: an ASCII
 * `filename` for old clients, and `filename*` so dashes, accents and
 * non-Latin names survive.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
