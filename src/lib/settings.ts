import { z } from "zod";

import { AiProvider, Creativity, DateFormat, PaperSize, Tone } from "@/generated/prisma/enums";
import { EMPTY_QUERY, JOB_SOURCES, JSEARCH_HOSTS, searchQuerySchema } from "@/lib/job-search/search";

/** Date styles for documents (SET-6), labelled with an example as in the prototype. */
export const DATE_FORMATS: readonly { value: DateFormat; label: string }[] = [
  { value: DateFormat.DAY_MONTH_YEAR, label: "27 September 2026" },
  { value: DateFormat.MONTH_DAY_YEAR, label: "September 27, 2026" },
  { value: DateFormat.NUMERIC, label: "27-09-2026" },
];

/**
 * Formats a calendar date in the chosen style, with month names in the
 * document's language. Uses the date's UTC day, so pass a date at UTC midnight.
 */
export function formatDocumentDate(date: Date, format: DateFormat, locale = "en-US"): string {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  if (format === DateFormat.NUMERIC) {
    const month = date.getUTCMonth() + 1;
    return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
  }
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date);
  return format === DateFormat.DAY_MONTH_YEAR ? `${day} ${month} ${year}` : `${month} ${day}, ${year}`;
}

/**
 * How long a finished background job is kept (Settings → Your data). Its
 * input and result hold what an AI task was given and wrote: a posting,
 * a resume's text, drafts not yet in an application.
 */
export const JOB_RETENTION_OPTIONS: readonly { hours: number; label: string }[] = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 24 * 7, label: "7 days" },
  { hours: 24 * 30, label: "30 days" },
];
export const DEFAULT_JOB_RETENTION_HOURS = 24;
export const isJobRetention = (hours: number) => JOB_RETENTION_OPTIONS.some((option) => option.hours === hours);
/** "24 hours" */
export const jobRetentionLabel = (hours: number) =>
  JOB_RETENTION_OPTIONS.find((option) => option.hours === hours)?.label ?? `${hours} hours`;

// ─── Stored settings ─────────────────────────────────────────────────────────
// Settings are stored in the Setting table, one text row per key: enums by
// name, flags as "true"/"false", lists as JSON. A missing key, or a value that
// doesn't fit, reads as the default below; null means "not set".

export const DEFAULT_BASE_THEME = "editorial";

const flag = (fallback: boolean) => z.stringbool().catch(fallback);

/** A list stored as a JSON array of strings. */
const stringList = z
  .string()
  .transform((value): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  })
  .pipe(z.array(z.string()));

export const settingsSchema = z.object({
  // AI provider (SET-1). Null means "not set in the app": fall back to the
  // DOSSIER_AI_* environment variables, then to the built-in defaults.
  provider: z.enum(AiProvider).nullable().catch(null),
  baseUrl: z.string().nullable().catch(null),
  model: z.string().nullable().catch(null),
  /** Encrypted with a key derived from DOSSIER_SECRET (E6-2); never sent to the client. */
  apiKeyEnc: z.string().nullable().catch(null),
  creativity: z.enum(Creativity).catch(Creativity.BALANCED),
  /** "Never invent experience" (SET-4). */
  strict: flag(true),
  /** "Show what changed" (SET-5). */
  showDiff: flag(true),
  paper: z.enum(PaperSize).catch(PaperSize.A4),
  dateFormat: z.enum(DateFormat).catch(DateFormat.DAY_MONTH_YEAR),
  defaultTone: z.enum(Tone).catch(Tone.WARM),
  /** Language for generated documents; null means "the posting's language" (SET-7). */
  docLanguage: z.string().nullable().catch(null),
  /** Languages added with "Other language…", kept in the list. */
  customLanguages: stringList.catch([]),
  fileNamePattern: z.string().catch("{name} – {company} – {doc}"),
  includeRefs: flag(false),
  onePage: flag(true),
  nightlyBackup: flag(true),
  /** Finished background jobs are deleted after this many hours (JOB_RETENTION_OPTIONS). */
  jobRetentionHours: z.coerce.number().refine(isJobRetention).catch(DEFAULT_JOB_RETENTION_HOURS),
  /** A theme's id. loadSettings() reads a deleted one as Editorial. */
  baseThemeId: z.string().catch(DEFAULT_BASE_THEME),
  /** The Applications screen as last left (LST-7): view, filter and sort, e.g. "-match". */
  applicationsView: z.enum(["board", "table"]).catch("board"),
  applicationsFilter: z.enum(["all", "active", "closed"]).catch("all"),
  applicationsSort: z.string().catch("updated"),
  /** The dashboard's period as last left (E9-8). */
  dashboardPeriod: z.enum(["30d", "90d", "all"]).catch("all"),
  /** Days without news before "Worth a look" suggests a follow-up (E9-9). */
  quietDays: z.coerce.number().int().min(1).max(60).catch(7),
  /** Experience and education: newest first by date, or the order set by hand (E4-9). */
  experienceOrder: z.enum(["date", "manual"]).catch("date"),
  educationOrder: z.enum(["date", "manual"]).catch("date"),
  /** Why the last nightly backup failed; null once one works again (E10-7). */
  backupProblem: z.string().nullable().catch(null),
  // Job search (E14-4). Null means "not set in the app": DOSSIER_JOBS_SOURCE
  // decides. "OFF" is a choice. Each source keeps its own key, encrypted
  // like the AI key, so switching back and forth loses nothing.
  jobSource: z.enum([...JOB_SOURCES, "OFF"]).nullable().catch(null),
  jsearchKeyEnc: z.string().nullable().catch(null),
  /** Where the JSearch key is from: OpenWeb Ninja, or the RapidAPI marketplace. */
  jsearchHost: z.enum(JSEARCH_HOSTS).catch("openwebninja"),
  adzunaAppId: z.string().nullable().catch(null),
  adzunaKeyEnc: z.string().nullable().catch(null),
  // Job agent (E16): one search, run on a schedule. Off until it's chosen.
  // The source is the one in Settings → Job search, so its key and country
  // rules are shared with Find jobs.
  agentEnabled: flag(false),
  /** The search the agent runs; keywords must not be empty to run. */
  agentQuery: z
    .string()
    .transform((value): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })
    .pipe(searchQuerySchema)
    .catch(EMPTY_QUERY),
  /** The hour (server time) the daily run starts. */
  agentHour: z.coerce.number().int().min(0).max(23).catch(7),
  /** Postings below this score are kept out of the queue. */
  agentMinScore: z.coerce.number().int().min(0).max(100).catch(70),
  /** The most postings one run scores, to keep AI and source use bounded. */
  agentMaxScores: z.coerce.number().int().min(1).max(30).catch(15),
  /** The most drafts one run prepares automatically. */
  agentMaxDrafts: z.coerce.number().int().min(0).max(10).catch(3),
  /** Whether a run writes drafts for the best postings, or only scores them. */
  agentAutoDraft: flag(true),
  /** The last run, for the daily guard and the screen. */
  agentLastRunAt: z.string().datetime().nullable().catch(null),
  /** "Check for updates daily" in Settings → About (update-check.ts). */
  updateCheck: flag(true),
  // The newest release the update check has seen, the UTC day it last
  // asked, and the release "Not now" hid the sidebar notice for. They belong
  // to the install, not its data, so exports leave them out (INSTALL_SETTINGS).
  latestVersion: z.string().nullable().catch(null),
  latestVersionUrl: z.string().nullable().catch(null),
  updateCheckDay: z.string().nullable().catch(null),
  updateDismissed: z.string().nullable().catch(null),
  // Gmail and Calendar (E15). Off until the Google account is connected.
  // The OAuth client, entered in Settings → Google. Null means "not set in the
  // app": DOSSIER_GOOGLE_CLIENT_ID and DOSSIER_GOOGLE_CLIENT_SECRET decide.
  googleClientId: z.string().nullable().catch(null),
  /** Encrypted like the API keys (GOOGLE_CLIENT_SECRET); never sent to the client. */
  googleClientSecretEnc: z.string().nullable().catch(null),
  /** Read replies from Gmail. */
  gmailRead: flag(true),
  /** Which mail the inbox check reads: only threads Dossier knows and company domains, or every new mail. */
  gmailScope: z.enum(["known", "all"]).catch("known"),
  /** Minutes between inbox checks. */
  gmailInterval: z.coerce.number().int().min(5).max(120).catch(10),
  /** Look in the calendar for free times when an employer asks to meet. */
  calendarAvailability: flag(true),
  /** Add agreed interviews to the calendar. */
  calendarEvents: flag(true),
  /** The calendar to read and write; "primary" is the account's own. */
  calendarId: z.string().catch("primary"),
  /** Working days, 1 = Monday … 7 = Sunday, as JSON. */
  workDays: z
    .string()
    .transform((value): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })
    .pipe(z.array(z.number().int().min(1).max(7)))
    .catch([1, 2, 3, 4, 5]),
  /** Working hours as "HH:MM". */
  workStart: z.string().regex(/^\d{2}:\d{2}$/).catch("09:00"),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/).catch("17:00"),
  /** The time zone for free slots and interviews; null means the browser's. */
  workTimeZone: z.string().nullable().catch(null),
  /** Interview length and the gap kept around other meetings, in minutes. */
  slotMinutes: z.coerce.number().int().min(15).max(240).catch(45),
  bufferMinutes: z.coerce.number().int().min(0).max(120).catch(15),
  // The usage ping (usage-ping.ts): this install's random ID, made by its
  // first ping, and the UTC day of the last one. They belong to the install,
  // not its data, so exports leave them out (INSTALL_SETTINGS).
  usagePingId: z.string().nullable().catch(null),
  usagePingDay: z.string().nullable().catch(null),
  // The browser's time zone as it last told the server, for work done
  // without a request, such as the inbox check (time-zone.ts). It belongs
  // to the install, not its data, so exports leave it out (INSTALL_SETTINGS).
  browserTimeZone: z.string().nullable().catch(null),
});
export type SettingsData = z.output<typeof settingsSchema>;

/** The settings from Setting rows; keys it doesn't know are ignored. */
export function settingsFromRows(rows: readonly { key: string; value: string }[]): SettingsData {
  return settingsSchema.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}

/** The text stored for a setting's value, or null for "not set", whose row is removed. */
export function settingValue(value: SettingsData[keyof SettingsData]): string | null {
  if (value === null) return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
