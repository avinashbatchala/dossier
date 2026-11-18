import { z } from "zod";

import { AiProvider, Creativity, DateFormat, PaperSize, Tone } from "@/generated/prisma/enums";
import { announcementFeedSchema } from "@/lib/announcements/contract";
import { JOB_SOURCES, JSEARCH_HOSTS } from "@/lib/job-search/search";
import { setupGuideSchema } from "@/lib/setup-guide";
import { SCORERS } from "@/lib/scoring/scorers";
import { startupsRefreshSchema } from "@/lib/startups/types";
import { AGENT_MAX_SLOTS_PER_RUN } from "@/lib/agent/limits";
import { AI_TIMEOUT_LIMITS } from "@/lib/ai/provider-options";
import { COVERS, coversFromScore, type Covers } from "@/lib/posting-coverage";

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
 * How long a finished background job is kept (Settings → Data and backups). Its
 * input and result hold what an AI task was given and wrote: a posting,
 * a resume's text, drafts not yet in an application.
 */
export const JOB_RETENTION_OPTIONS: readonly { hours: number; label: string }[] = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 24 * 7, label: "7 days" },
  { hours: 24 * 30, label: "30 days" },
];
const DEFAULT_JOB_RETENTION_HOURS = 24;
export const isJobRetention = (hours: number) => JOB_RETENTION_OPTIONS.some((option) => option.hours === hours);
/** Days an untouched posting stays in Positions after a search last found it, before it moves to the Archive (E22-7). */
export const ARCHIVE_DAYS = [14, 30, 60, 90] as const;
export const DEFAULT_ARCHIVE_DAYS = 30;
export const isArchiveDays = (days: number) => (ARCHIVE_DAYS as readonly number[]).includes(days);
/** "24 hours" */
export const jobRetentionLabel = (hours: number) =>
  JOB_RETENTION_OPTIONS.find((option) => option.hours === hours)?.label ?? `${hours} hours`;

/** Which documents New application writes (#367): many job sites ask for only one. */
export const DOCUMENTS_TO_WRITE = ["both", "resume", "letter"] as const;
export type DocumentsToWrite = (typeof DOCUMENTS_TO_WRITE)[number];
export const DOCUMENTS_TO_WRITE_LABELS: Record<DocumentsToWrite, string> = { both: "Resume and cover letter", resume: "Resume only", letter: "Cover letter only" };

// ─── Stored settings ─────────────────────────────────────────────────────────
// Settings are stored in the Setting table, one text row per key: enums by
// name, flags as "true"/"false", lists as JSON. A missing key, or a value that
// doesn't fit, reads as the default below; null means "not set".

export const DEFAULT_BASE_THEME = "editorial";

export const flag = (fallback: boolean) => z.stringbool().catch(fallback);

/** A value stored as JSON. */
export const json = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((value): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })
    .pipe(schema);

/** A list stored as a JSON array of strings. */
const stringList = json(z.array(z.string()));

/**
 * One run of the job agent (E16), kept here rather than as its Job, which
 * the task-data sweep deletes: the source-request quota counts these.
 */
/** "Test connection" in Settings → AI provider, as last run (E34-1): when, how long, and what went wrong. */
const aiTestSchema = z.object({
  at: z.iso.datetime(),
  provider: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  ok: z.boolean(),
  /** How long it took, for a test that worked. */
  seconds: z.number().nullable(),
  /** What went wrong, for one that didn't. */
  error: z.string().nullable(),
});
export type AiTest = z.infer<typeof aiTestSchema>;

const agentSearchRunSchema = z.object({
  searchId: z.string(),
  searchName: z.string(),
  found: z.number().int().min(0),
  fresh: z.number().int().min(0),
  error: z.string().nullable(),
  /** Since E22-8: the search it ran as, with what it found (Positions → Found by the agent). */
  postingSearchId: z.string().optional(),
  /** Since E22-8: each portal it asked, how many it found, and what went wrong. */
  portals: z.array(z.object({ id: z.string(), status: z.string(), found: z.number().int().min(0), message: z.string().nullable() })).optional(),
});
export type AgentSearchRun = z.infer<typeof agentSearchRunSchema>;
const agentRunSchema = z.object({
  at: z.iso.datetime(),
  manual: z.boolean(),
  /** What the run ended with, for the Agent screen; null while it runs. */
  message: z.string().nullable(),
  /** Slots reserved together before dispatch. Legacy runs consumed one slot. */
  sourceRequests: z.number().int().min(1).max(AGENT_MAX_SLOTS_PER_RUN).optional(),
  /** Each reserved slot's timestamp, advanced immediately before dispatch. */
  sourceRequestAts: z.array(z.iso.datetime()).min(1).max(AGENT_MAX_SLOTS_PER_RUN).optional(),
  /** Each slot's portal (E22-8); a slot from before counts against every portal. */
  sourceRequestPortals: z.array(z.string()).max(AGENT_MAX_SLOTS_PER_RUN).optional(),
  searches: z.array(agentSearchRunSchema).optional(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;
/** How many runs are kept: more than a day's worth, for the limit and the screen. */
export const AGENT_RUNS_KEPT = 10;

/** The dashboard's daily note (E28-6, DB2): today's only, replaced the next day. */
const dailyNoteSchema = z.object({
  /** The day it's for, YYYY-MM-DD in the user's time zone. */
  day: z.string(),
  text: z.string().max(500),
  /** How many times "Another one" was used that day. */
  rewrites: z.number().int().min(0),
  /** "Hide for today": until local midnight, when the day changes. */
  hidden: z.boolean(),
});
export type DailyNote = z.infer<typeof dailyNoteSchema>;

const settingsSchema = z.object({
  // AI provider (SET-1). Null means "not set in the app": fall back to the
  // DOSSIER_AI_* environment variables, then to the built-in defaults.
  provider: z.enum(AiProvider).nullable().catch(null),
  baseUrl: z.string().nullable().catch(null),
  model: z.string().nullable().catch(null),
  /** Encrypted with a key derived from DOSSIER_SECRET (E6-2); never sent to the client. */
  apiKeyEnc: z.string().nullable().catch(null),
  /** How long one AI request may take, in seconds (public issue 118); null for DOSSIER_AI_TIMEOUT_SECONDS's, or the provider's own. */
  aiTimeoutSeconds: z.coerce.number().int().min(AI_TIMEOUT_LIMITS.min).max(AI_TIMEOUT_LIMITS.max).nullable().catch(null),
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
  /** What New application writes unless chosen there (#367). */
  documentsToWrite: z.enum(DOCUMENTS_TO_WRITE).catch("both"),
  nightlyBackup: flag(true),
  /** Finished background jobs are deleted after this many hours (JOB_RETENTION_OPTIONS). */
  jobRetentionHours: z.coerce.number().refine(isJobRetention).catch(DEFAULT_JOB_RETENTION_HOURS),
  /** The Applications screen as last left (LST-7): view, filter and sort, e.g. "-match". */
  applicationsView: z
    .enum(["board", "list", "table"])
    .transform((view) => (view === "table" ? "list" : view))
    .catch("board"),
  /** No longer used: the status tabs replaced In progress and Closed (E29-1). */
  applicationsFilter: z.enum(["all", "active", "closed"]).catch("all"),
  /** The statuses where Board was chosen over the list (E29-1, LB1), as `status=` writes them. */
  applicationsBoardStatuses: stringList.catch([]),
  applicationsSort: z.string().catch("updated"),
  /** The dashboard's period as last left (E9-8). */
  dashboardPeriod: z.enum(["30d", "90d", "all"]).catch("all"),
  /** Days without news before Needs you suggests a follow-up (E9-9). */
  quietDays: z.coerce.number().int().min(1).max(60).catch(7),
  /** Today's daily note (E28-6); null before the first one. */
  dailyNote: json(dailyNoteSchema).nullable().catch(null),
  /** Whether the AI writes the daily note (U3); off, or without a provider, a written one is picked. */
  dailyNoteAi: flag(true),
  /** The profile last opened on Profile or Base resume (E24-2), which they open next; null or a deleted one reads as the first. */
  openProfileId: z.string().nullable().catch(null),
  /** Where the setup guide was left (E21); null until it's first opened. */
  setupGuide: json(setupGuideSchema).nullable().catch(null),
  /** Why the last nightly backup failed; null once one works again (E10-7). */
  backupProblem: z.string().nullable().catch(null),
  // Job search (E22-3): which portals are on and their fields, by portal id.
  // Null means "not set in the app": DOSSIER_JOBS_SOURCE decides. Secrets are
  // in portalKeysEnc, each encrypted like the AI key, and never exported.
  portals: json(z.record(z.string(), z.object({ on: z.boolean().catch(false), fields: z.record(z.string(), z.string().max(5000)).catch({}), acceptedAt: z.iso.datetime().nullable().catch(null) })))
    .nullable()
    .catch(null),
  portalKeysEnc: json(z.record(z.string(), z.record(z.string(), z.string()))).catch({}),
  /** Portals the user keeps searching although the catalog withdrew them (E23-5): portal id → the withdrawal's time. */
  portalWithdrawalsKept: json(z.record(z.string(), z.string())).catch({}),
  /** Days before an untouched posting moves to the Archive (E22-7). */
  archiveAfterDays: z.coerce.number().refine(isArchiveDays).catch(DEFAULT_ARCHIVE_DAYS),
  // Before E22-3: one source and a key per source. Read until they're moved
  // into `portals` once (moveJobSettings in src/lib/job-search/config.ts),
  // and from older exports.
  jobSource: z.enum([...JOB_SOURCES, "OFF"]).nullable().catch(null),
  jsearchKeyEnc: z.string().nullable().catch(null),
  /** Where the JSearch key is from: OpenWeb Ninja, or the RapidAPI marketplace. */
  jsearchHost: z.enum(JSEARCH_HOSTS).catch("openwebninja"),
  adzunaAppId: z.string().nullable().catch(null),
  adzunaKeyEnc: z.string().nullable().catch(null),
  /** When "I understand" was ticked under the Bundesagentur für Arbeit's note (#223); its searches wait for it. */
  arbeitsagenturAcceptedAt: z.iso.datetime().nullable().catch(null),
  // Scoring (#274): what Score in Find jobs and the job agent score postings
  // with. Null means "not set in the app": DOSSIER_SCORER decides, else the
  // AI model. Jev's key is encrypted like the others, under its own key.
  scorer: z.enum(SCORERS).nullable().catch(null),
  typesafeKeyEnc: z.string().nullable().catch(null),
  /** OpenAI Decisions' key (E25-3), and OpenRouter's for scoring with its model (E25-4). */
  decisionsKeyEnc: z.string().nullable().catch(null),
  openrouterScoringKeyEnc: z.string().nullable().catch(null),
  /** The OpenRouter model that scores; null for the default (OPENROUTER_SCORING_MODEL). */
  openrouterScoringModel: z.string().trim().min(1).max(200).nullable().catch(null),
  // Job agent (E16): recurring searches, run once a day. Off until turned on.
  // It asks the source in Settings → Job search, with its key.
  agentEnabled: flag(false),
  /** The hour of the day it runs, in the user's time zone. */
  agentHour: z.coerce.number().int().min(0).max(23).catch(7),
  /** The 0–100 minimum from before coverage (E32-2); it gives agentCovers until that's set. */
  agentMinScore: z.coerce.number().int().min(0).max(100).catch(70),
  /** How much of a posting's requirements the profile must cover for the queue (E32-2); null follows agentMinScore. */
  agentCovers: z.enum(COVERS).nullable().catch(null),
  /** The most postings a run scores, and the most drafts it prepares on its own. */
  agentMaxScores: z.coerce.number().int().min(1).max(30).catch(15),
  agentMaxDrafts: z.coerce.number().int().min(0).max(10).catch(3),
  /** Whether a run prepares drafts for its best postings, or only scores them (off by default, #197). */
  agentAutoDraft: flag(false),
  /** The latest runs, newest first. They belong to the install: exports leave them out (INSTALL_SETTINGS). */
  agentRuns: json(z.array(agentRunSchema)).catch([]),
  // Startups (#222): when the screen was last opened, since the daily refresh
  // only runs while it's in use, and what the last refresh found. They belong
  // to the install, not its data, so exports leave them out (INSTALL_SETTINGS).
  startupsViewedAt: z.iso.datetime().nullable().catch(null),
  startupsLastRefresh: json(startupsRefreshSchema).nullable().catch(null),
  /** "Check for updates daily" in Settings → About (update-check.ts). */
  updateCheck: flag(true),
  // The newest release the update check has seen, the UTC day it last
  // asked, and the release "Not now" hid the sidebar notice for. They belong
  // to the install, not its data, so exports leave them out (INSTALL_SETTINGS).
  latestVersion: z.string().nullable().catch(null),
  /** The AI connection test's last result (E34-1), for the provider, address and model it tested; install-only. */
  aiTest: json(aiTestSchema).nullable().catch(null),
  latestVersionUrl: z.string().nullable().catch(null),
  updateCheckDay: z.string().nullable().catch(null),
  updateDismissed: z.string().nullable().catch(null),
  // The backend's notices (announcements/check.ts): its last answer, and the
  // ones dismissed here. They belong to the install, not its data, so exports
  // leave them out (INSTALL_SETTINGS).
  announcementFeed: json(announcementFeedSchema).nullable().catch(null),
  announcementsDismissed: stringList.catch([]),
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
  workDays: json(z.array(z.number().int().min(1).max(7))).catch([1, 2, 3, 4, 5]),
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
  // Whether the operator agreed to the usage ping (#172), when, and which
  // version of the question they answered (USAGE_PING_TEXT_VERSION), so the
  // consent can be shown. Null: not answered yet, and nothing is sent.
  usagePingChoice: z.enum(["on", "off"]).nullable().catch(null),
  usagePingChoiceAt: z.string().nullable().catch(null),
  usagePingChoiceText: z.coerce.number().int().nullable().catch(null),
  // The Claude connector (#221): when it was turned on, or Claude was last
  // disconnected; null while it's off, and then its addresses answer 404.
  // Every connector token carries it, so a new value signs Claude out. It
  // belongs to the install, so exports leave it out (INSTALL_SETTINGS).
  connectorEnabledAt: z.iso.datetime().nullable().catch(null),
  /** Other MCP apps' callback addresses, allowed like Claude's (#281). The install's too: an import must never add one. */
  connectorRedirects: stringList.catch([]),
  // The browser's time zone as it last told the server, for work done
  // without a request, such as the inbox check (time-zone.ts). It belongs
  // to the install, not its data, so exports leave it out (INSTALL_SETTINGS).
  browserTimeZone: z.string().nullable().catch(null),
  // The address the user last opened Dossier at (E26-1), for notifications'
  // links when DOSSIER_PUBLIC_URL isn't set. The install's too, like the zone.
  lastOrigin: z.string().nullable().catch(null),
  // What notifications already said, so each is said once (E26-5, E26-7):
  // portal withdrawals by "withdrawn:<id>" (its date) and updates by
  // "update:<id>" (the version); the local day the daily check last ran;
  // the last new version announced. The install's, not its data.
  portalNotices: json(z.record(z.string(), z.string())).catch({}),
  notificationsDay: z.string().nullable().catch(null),
  notifiedVersion: z.string().nullable().catch(null),
});
export type SettingsData = z.output<typeof settingsSchema>;

/** The settings from Setting rows; keys it doesn't know are ignored. */
export function settingsFromRows(rows: readonly { key: string; value: string }[]): SettingsData {
  // Old keys, such as Resume length's pageLimit (removed with the trimmer, #234), are left out here.
  const values: Record<string, string> = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return settingsSchema.parse(values);
}

/** The text stored for a setting's value, or null for "not set", whose row is removed. */
export function settingValue(value: SettingsData[keyof SettingsData]): string | null {
  if (value === null) return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** The agent's cut-off (E32-2): as set, else moved over from the 0–100 minimum. */
export const agentCoversOf = (settings: Pick<SettingsData, "agentCovers" | "agentMinScore">): Covers => settings.agentCovers ?? coversFromScore(settings.agentMinScore);
