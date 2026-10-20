import "server-only";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  AgentCandidateStatus,
  ApplicationOrigin,
  ApplicationStatus,
  ChatRole,
  DateStyle,
  Density,
  DocumentKind,
  FunnelStage,
  HeaderStyle,
  HeadingStyle,
  LanguageLevel,
  PostingSource,
  SidebarStyle,
  ThemeAlign,
  ThemeFont,
  ThemeLayout,
  Tone,
  VersionCause,
} from "@/generated/prisma/enums";
import { decryptApiKey } from "@/lib/ai/api-key";
import { decryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";
import { appVersion } from "@/lib/version";

// Everything a user keeps in Dossier as one JSON file (E10-4, SET-10): the
// profile, custom themes, settings and applications with their history,
// documents, chat and notes, the postings kept from Find jobs (E14-9) and
// the job agent's candidates (E16), so its dedupe survives a restore.
// IDs are kept, so an import restores every link. Jobs, sign-in throttling,
// built-in themes, the Google account and the mail fetched from Gmail stay
// behind: they belong to the server or the mailbox, not the user's data.

export const EXPORT_FORMAT = "dossier-export";
/** Bump when the file's shape changes; imports refuse versions they don't know. 2 added Find jobs' postings and keys (E14-9), 3 projects (PRO-13) and the job agent (E16). */
export const EXPORT_SCHEMA_VERSION = 3;
/** The versions imports can read. */
export const EXPORT_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3];

/** The setting that holds the encrypted API key, which only this server can read. */
const API_KEY_SETTING = "apiKeyEnc";
/** The settings that hold encrypted keys, which only this server can read: never exported as they are. */
export const SECRET_SETTINGS: readonly string[] = [API_KEY_SETTING, "jsearchKeyEnc", "adzunaKeyEnc"];
/** The settings that belong to this install rather than its data (the usage ping's and its consent, the update check's, the Google client and the browser's time zone): never exported, and kept by an import. */
export const INSTALL_SETTINGS: readonly string[] = [
  "usagePingId",
  "usagePingDay",
  "usagePingChoice",
  "usagePingChoiceAt",
  "usagePingChoiceText",
  // The job agent's runs count against this server's job source key (E16).
  "agentRuns",
  "latestVersion",
  "latestVersionUrl",
  "updateCheckDay",
  "updateDismissed",
  "googleClientId",
  "googleClientSecretEnc",
  "browserTimeZone",
];

const date = z.iso.datetime().transform((value) => new Date(value));
const optionalDate = date.nullable();
const int = z.number().int();
const text = z.string();

const skill = z.object({ id: text, name: text, sort: int, createdAt: date });
const language = z.object({ id: text, name: text, level: z.enum(LanguageLevel), sort: int, createdAt: date });
const span = {
  startYear: int.nullable(),
  startMonth: int.nullable(),
  endYear: int.nullable(),
  endMonth: int.nullable(),
  current: z.boolean(),
};
const experience = z.object({
  id: text,
  role: text,
  company: text,
  location: text,
  ...span,
  bullets: text,
  sort: int,
  /** The skills used in the role. */
  skillIds: z.array(text),
  createdAt: date,
  updatedAt: date,
});
const project = z.object({
  id: text,
  name: text,
  link: text,
  ...span,
  bullets: text,
  sort: int,
  /** The skills used in the project. */
  skillIds: z.array(text),
  createdAt: date,
  updatedAt: date,
});
const education = z.object({ id: text, degree: text, school: text, ...span, notes: text, sort: int, createdAt: date, updatedAt: date });
const reference = z.object({
  id: text,
  name: text,
  relation: text,
  company: text,
  email: text,
  phone: text,
  sort: int,
  createdAt: date,
  updatedAt: date,
});
const theme = z.object({
  id: text,
  name: text,
  headFont: z.enum(ThemeFont),
  bodyFont: z.enum(ThemeFont),
  accent: text,
  layout: z.enum(ThemeLayout),
  align: z.enum(ThemeAlign),
  headingStyle: z.enum(HeadingStyle),
  density: z.enum(Density),
  /** Absent in older files, which take the defaults. */
  headerStyle: z.enum(HeaderStyle).optional(),
  sidebarStyle: z.enum(SidebarStyle).optional(),
  dateStyle: z.enum(DateStyle).optional(),
  createdAt: date,
  updatedAt: date,
});
const keyValue = z.object({ key: text, value: text });

const statusEvent = z.object({
  id: text,
  from: z.enum(ApplicationStatus),
  to: z.enum(ApplicationStatus),
  at: date,
  previousFurthestStage: z.enum(FunnelStage).nullable(),
  previousSentAt: optionalDate,
});
const document = z.object({
  id: text,
  kind: z.enum(DocumentKind),
  units: z.unknown(),
  themeId: text.nullable(),
  writtenWith: text.nullable(),
  /** Parts left out to fit the page limit (E10-10); absent in older files. */
  trimmed: z.unknown().nullable().optional(),
  /** Earlier versions (E8-10); absent in older files. */
  versions: z
    .array(z.object({ id: text, units: z.unknown(), cause: z.enum(VersionCause), detail: text, createdAt: date }))
    .optional(),
  updatedAt: date,
});
const chatMessage = z.object({
  id: text,
  role: z.enum(ChatRole),
  text,
  targetUnit: text.nullable(),
  edits: z.unknown().nullable(),
  undone: z.boolean(),
  previousTone: z.enum(Tone).nullable(),
  writtenWith: text.nullable(),
  createdAt: date,
});
const note = z.object({ id: text, body: text, createdAt: date, updatedAt: date });
const application = z.object({
  id: text,
  title: text,
  company: text,
  role: text,
  location: text,
  mode: text,
  salary: text,
  deadline: optionalDate,
  postingUrl: text,
  postingText: text,
  extracted: z.unknown().nullable(),
  extractedWith: text.nullable(),
  match: z.unknown().nullable(),
  matchedWith: text.nullable(),
  status: z.enum(ApplicationStatus),
  furthestStage: z.enum(FunnelStage).nullable(),
  sentAt: optionalDate,
  /** The next interview (E9-9); absent in older files. */
  nextInterviewAt: optionalDate.optional(),
  tone: z.enum(Tone),
  userNote: text,
  language: text,
  followThemeLayout: z.boolean(),
  /** The job agent's (E16); absent in older files, which hold only the user's own. */
  origin: z.enum(ApplicationOrigin).optional(),
  agentScore: int.nullable().optional(),
  awaitingReview: z.boolean().optional(),
  archivedAt: optionalDate,
  createdAt: date,
  updatedAt: date,
  events: z.array(statusEvent),
  documents: z.array(document),
  messages: z.array(chatMessage),
  notes: z.array(note),
});

/** A posting the job agent found (E16). */
const agentCandidate = z.object({
  id: text,
  source: z.enum(PostingSource),
  externalId: text,
  title: text,
  company: text,
  place: text,
  remote: z.boolean().nullable(),
  salary: text,
  postedAt: optionalDate,
  url: text,
  via: text,
  description: text,
  complete: z.boolean(),
  score: int,
  reasons: z.unknown().nullable(),
  redFlags: z.unknown().nullable(),
  status: z.enum(AgentCandidateStatus),
  error: text.nullable(),
  applicationId: text.nullable(),
  dedupeKey: text,
  createdAt: date,
  updatedAt: date,
});

/** A posting kept from Find jobs (E14-5). */
const posting = z.object({
  id: text,
  source: z.enum(PostingSource),
  externalId: text,
  title: text,
  company: text,
  place: text,
  remote: z.boolean().nullable(),
  salary: text,
  postedAt: optionalDate,
  url: text,
  via: text,
  description: text,
  complete: z.boolean(),
  savedAt: optionalDate,
  dismissedAt: optionalDate,
  applicationId: text.nullable(),
  createdAt: date,
  updatedAt: date,
});

/** A search kept with what it found (E14-10); its search and postings are checked when it's opened. */
const postingSearch = z.object({
  id: text,
  source: z.enum(PostingSource),
  query: z.unknown(),
  postings: z.unknown(),
  found: int,
  next: text.nullable(),
  createdAt: date,
  updatedAt: date,
});

/** An export file as read back (E10-6). */
export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.literal([1, 2, 3]),
  appVersion: text,
  exportedAt: date,
  profile: z.object({
    fields: z.array(keyValue),
    skills: z.array(skill),
    languages: z.array(language),
    experience: z.array(experience),
    /** Absent in files before version 3. */
    projects: z.array(project).default([]),
    education: z.array(education),
    references: z.array(reference),
  }),
  themes: z.array(theme),
  settings: z.array(keyValue),
  /** The AI provider's key in plain text, only when the user asked for it. */
  apiKey: text.optional(),
  /** The job sources' keys in plain text, likewise (E14-9). */
  jobSourceKeys: z.object({ jsearch: text.optional(), adzuna: text.optional() }).optional(),
  applications: z.array(application),
  /** Saved and dismissed postings (E14-9); absent in version 1 files. */
  postings: z.array(posting).default([]),
  /** Past searches with what they found (E14-10); absent in version 1 files. */
  searches: z.array(postingSearch).default([]),
  /** The job agent's candidates (E16); absent in older files. */
  agentCandidates: z.array(agentCandidate).default([]),
});
export type DossierExport = z.infer<typeof exportSchema>;

/** "dossier-export-2026-09-28.json", dated in the server's time zone. */
export function exportFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `dossier-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * Collects everything into an export (E10-4). The API key is left out,
 * unless `includeApiKey`: then it's decrypted, since another server's
 * DOSSIER_SECRET couldn't read the encrypted copy (PRD §11). One read-only
 * transaction, so the export is a consistent snapshot. Also used for
 * backups (E10-6, E10-7).
 */
export async function buildExport(
  db: PrismaClient,
  { includeApiKey = false, now = new Date() }: { includeApiKey?: boolean; now?: Date } = {},
): Promise<DossierExport> {
  return db.$transaction(async (tx) => {
    const [fields, skills, languages, experience, projects, education, references, themes, settings, applications, postings, searches, agentCandidates] = await Promise.all([
      tx.profileField.findMany({ select: { key: true, value: true }, orderBy: { key: "asc" } }),
      tx.skill.findMany({ select: { id: true, name: true, sort: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
      tx.language.findMany({ select: { id: true, name: true, level: true, sort: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
      tx.experience.findMany({ include: { skills: { select: { skillId: true } } }, orderBy: { createdAt: "asc" } }),
      tx.project.findMany({ include: { skills: { select: { skillId: true } } }, orderBy: { createdAt: "asc" } }),
      tx.education.findMany({ orderBy: { createdAt: "asc" } }),
      tx.reference.findMany({ orderBy: { createdAt: "asc" } }),
      tx.theme.findMany({ where: { builtIn: false }, omit: { builtIn: true }, orderBy: { createdAt: "asc" } }),
      tx.setting.findMany({ select: { key: true, value: true }, orderBy: { key: "asc" } }),
      tx.application.findMany({
        orderBy: { createdAt: "asc" },
        // The Gmail thread belongs to the mailbox, not the data (E15-2).
        omit: { emailThreadId: true, interviewEventId: true, interviewCalendarId: true },
        include: {
          events: { omit: { applicationId: true }, orderBy: { at: "asc" } },
          documents: {
            omit: { applicationId: true },
            orderBy: { kind: "asc" },
            include: { versions: { omit: { documentId: true }, orderBy: { createdAt: "asc" } } },
          },
          messages: { omit: { applicationId: true }, orderBy: { createdAt: "asc" } },
          notes: { omit: { applicationId: true }, orderBy: { createdAt: "asc" } },
        },
      }),
      tx.posting.findMany({ orderBy: { createdAt: "asc" } }),
      tx.postingSearch.findMany({ orderBy: { createdAt: "asc" } }),
      tx.agentCandidate.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

    // Keys only when asked for, decrypted; one that's unreadable here too (DOSSIER_SECRET changed) has nothing to export.
    const stored = (key: string) => (includeApiKey ? settings.find((setting) => setting.key === key)?.value : undefined);
    const readable = (value: string | undefined, decrypt: (value: string) => string) => {
      try {
        return value ? decrypt(value) : undefined;
      } catch {
        return undefined;
      }
    };
    const apiKey = readable(stored(API_KEY_SETTING), (value) => decryptApiKey(value));
    const jobSourceKeys = Object.fromEntries(
      Object.entries({
        jsearch: readable(stored("jsearchKeyEnc"), (value) => decryptSecret(JOB_SOURCE_KEY, value)),
        adzuna: readable(stored("adzunaKeyEnc"), (value) => decryptSecret(JOB_SOURCE_KEY, value)),
      }).filter(([, value]) => value),
    );

    return {
      format: EXPORT_FORMAT,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      appVersion,
      exportedAt: now,
      profile: {
        fields,
        skills,
        languages,
        experience: experience.map(({ skills: links, ...entry }) => ({ ...entry, skillIds: links.map((link) => link.skillId) })),
        projects: projects.map(({ skills: links, ...entry }) => ({ ...entry, skillIds: links.map((link) => link.skillId) })),
        education,
        references,
      },
      themes,
      settings: settings.filter((setting) => !SECRET_SETTINGS.includes(setting.key) && !INSTALL_SETTINGS.includes(setting.key)),
      ...(apiKey ? { apiKey } : {}),
      ...(Object.keys(jobSourceKeys).length > 0 ? { jobSourceKeys } : {}),
      applications,
      postings,
      searches,
      agentCandidates,
    };
  });
}
