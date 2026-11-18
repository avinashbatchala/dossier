import "server-only";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { AgentCandidateStatus, ApplicationOrigin, ApplicationStatus, ChatRole, CustomSectionCountsAs, CustomSectionFormat, DateStyle, Density, DocumentKind, FunnelStage, HeaderStyle, HeadingStyle, LanguageLevel, NotificationChannelType, PhotoPosition, PhotoShape, SentVia, SidebarStyle, StartupStatus, ThemeAlign, ThemeFont, ThemeLayout, Tone, VersionCause } from "@/generated/prisma/enums";
import { SCORER_KEY_SETTINGS } from "@/lib/scoring/scorers";
import { decryptApiKey } from "@/lib/ai/api-key";
import { agentSearchInputSchema, MAX_AGENT_SEARCHES } from "@/lib/agent/search";
import { sourceIdSchema } from "@/lib/job-search/search";
import { savedPortalKeys } from "@/lib/job-search/config";
import { decryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";
import { settingsFromRows } from "@/lib/settings";
import { appVersion } from "@/lib/version";
import { workplaceFrom } from "@/lib/profile-workplace";

// Everything a user keeps in Dossier as one JSON file (E10-4, SET-10): the
// profile, custom themes, settings and applications with their history,
// documents, chat and notes, the postings kept from Find jobs (E14-9) and
// the job agent's candidates (E16), so its dedupe survives a restore, and
// Startups with what the user did with them (#222).
// IDs are kept, so an import restores every link. Jobs, sign-in throttling,
// built-in themes, the Google account and the mail fetched from Gmail stay
// behind: they belong to the server or the mailbox, not the user's data.

export const EXPORT_FORMAT = "dossier-export";
/** Bump when the file's shape changes; imports refuse versions they don't know. 2 added Find jobs' postings and keys (E14-9), 3 projects (PRO-13) and the job agent (E16), 4 facts (PRO-14, APP-15), 5 publications (#218), the profile photo's theme and application options (#224) and Startups (#222), 6 the line about a role's company (#257), 7 skill groups (#280), 8 certifications (#293) and volunteering (#294), 9 resume section order (#297), custom sections (#298) and what sent applications were sent with (#299), and the board's order (public issue 60), 10 the tailored resume's score (#370), 11 the job agent's recurring searches and which found each candidate (public PR 61), 12 the positions library and the portals (E22, E23), 13 several profiles (E24-1), 14 the gaps the user doesn't have (E30-5), 15 interview rounds, offers and drafted messages (E30-6, E30-7, E30-8), 16 the job agent's coverage per candidate and why it skipped one (E32-2, E32-5). */
export const EXPORT_SCHEMA_VERSION = 16;
/** The versions imports can read. */
export const EXPORT_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** The setting that holds the encrypted API key, which only this server can read. */
const API_KEY_SETTING = "apiKeyEnc";
/** The settings that hold encrypted keys, which only this server can read: never exported as they are. */
export const SECRET_SETTINGS: readonly string[] = [API_KEY_SETTING, "jsearchKeyEnc", "adzunaKeyEnc", "portalKeysEnc", ...SCORER_KEY_SETTINGS];
/** The settings that belong to this install rather than its data (the usage ping's and its consent, the update check's, the Google client and the browser's time zone): never exported, and kept by an import. */
export const INSTALL_SETTINGS: readonly string[] = [
  "usagePingId",
  "usagePingDay",
  "usagePingChoice",
  "usagePingChoiceAt",
  "usagePingChoiceText",
  // Whether this install's setup guide was opened, and where it was left (E21).
  "setupGuide",
  // Today's note on the dashboard (E28-6): gone tomorrow anyway.
  "dailyNote",
  // The job agent's runs count against this server's job source key (E16).
  "agentRuns",
  // When Startups was last opened and what its last refresh found (#222).
  "startupsViewedAt",
  "startupsLastRefresh",
  "latestVersion",
  "latestVersionUrl",
  // The AI connection test's last result (E34-1): this server's, against its own provider.
  "aiTest",
  "updateCheckDay",
  "updateDismissed",
  "announcementFeed",
  "announcementsDismissed",
  "googleClientId",
  "googleClientSecretEnc",
  "browserTimeZone",
  "lastOrigin",
  "portalNotices",
  "notificationsDay",
  "notifiedVersion",
  // An import must never open the MCP connector's addresses on this server (#221), or let another app sign in (#281).
  "connectorEnabledAt",
  "connectorRedirects",
];

const date = z.iso.datetime().transform((value) => new Date(value));
const optionalDate = date.nullable();
const int = z.number().int();
const text = z.string();

/** The profile a row belongs to (E24-1); absent in files before version 13, whose rows all go to one profile. */
const profileId = text.optional();
// Groups came in version 7 (#280); older files have none.
const skill = z.object({ id: text, profileId, name: text, sort: int, group: text.default(""), createdAt: date });
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
  profileId,
  role: text,
  company: text,
  location: text,
  /** Absent in files before version 6. */
  descriptor: text.optional(),
  /** Absent in files before version 8, where every role is a paid one. */
  volunteering: z.boolean().optional(),
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
  profileId,
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
const education = z.object({ id: text, profileId, degree: text, school: text, ...span, notes: text, sort: int, createdAt: date, updatedAt: date });
/** A certification (#293), with when it was obtained and when it runs out. */
const certification = z.object({
  id: text,
  profileId,
  name: text,
  issuer: text,
  year: int.nullable(),
  month: int.nullable(),
  expiryYear: int.nullable(),
  expiryMonth: int.nullable(),
  credentialId: text,
  link: text,
  onResumes: z.boolean(),
  sort: int,
  createdAt: date,
  updatedAt: date,
});
/** A publication (#218): its citation as written, with **bold** and *italic*. */
const publication = z.object({ id: text, profileId, citation: text, link: text, onResumes: z.boolean(), sort: int, createdAt: date, updatedAt: date });
/** A section the user made (#298), with its items. */
const customSection = z.object({
  id: text,
  profileId,
  title: text,
  format: z.enum(CustomSectionFormat),
  /** What it counts as (E24-5); absent in files before version 13, where every one is Extra activities. */
  countsAs: z.enum(CustomSectionCountsAs).default("EXTRA_ACTIVITIES"),
  items: z.array(
    z.object({
      id: text,
      title: text,
      subtitle: text,
      ...span,
      details: text,
      link: text,
      onResumes: z.boolean(),
      sort: int,
      createdAt: date,
      updatedAt: date,
    }),
  ),
  createdAt: date,
  updatedAt: date,
});
const reference = z.object({
  id: text,
  profileId,
  name: text,
  relation: text,
  company: text,
  email: text,
  phone: text,
  sort: int,
  createdAt: date,
  updatedAt: date,
});
/** A profile (E24-1): its name, headline, summary and own settings (src/lib/profile-settings.ts), as stored. */
const profileRow = z.object({
  id: text.min(1),
  name: text,
  sort: int,
  headline: text,
  summary: text,
  /** The levels it's for (E24-3), null until chosen. */
  levelFrom: text.nullable().default(null),
  levelTo: text.nullable().default(null),
  /** Where it wants to work (E24-4, src/lib/profile-workplace.ts), and when the user first looked at it. */
  workplace: z.record(text, z.unknown()).optional(),
  workplaceSeenAt: optionalDate.optional(),
  settings: z.record(text, text),
  createdAt: date,
  updatedAt: date,
});
/** A fact for the AI (PRO-14, APP-15), the profile's or an application's. */
const fact = z.object({ id: text, text, sort: int, createdAt: date, updatedAt: date });
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
  /** Absent before 1.9.0 (#224). */
  photoShape: z.enum(PhotoShape).optional(),
  photoPosition: z.enum(PhotoPosition).optional(),
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
  /** Absent in files before version 9. */
  previousBoardSort: int.nullable().optional(),
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
  /** The profile it was made from (E24-6); absent in files before version 13, which read the first. */
  profileId: text.nullable().optional(),
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
  /** Its place on the board (public issue 60); absent in files before version 9, whose columns are newest first. */
  boardSort: int.nullable().optional(),
  furthestStage: z.enum(FunnelStage).nullable(),
  sentAt: optionalDate,
  /** How it was sent (E29-7); absent in files from before 1.15. */
  sentVia: z.enum(SentVia).nullable().optional(),
  /** A follow-up or answer to the offer waiting to be sent, and "I sent it" (E30-7, E30-8); absent before version 15. */
  messageDraft: z.unknown().nullable().optional(),
  contactedAt: date.nullable().optional(),
  /** The next interview (E9-9); absent in older files. */
  nextInterviewAt: optionalDate.optional(),
  tone: z.enum(Tone),
  /** "Anything I should know?" in files before version 4; read as the application's first fact. */
  userNote: text.optional(),
  language: text,
  followThemeLayout: z.boolean(),
  /** Absent before 1.9.0, which follows the profile (#224). */
  showPhoto: z.boolean().nullable().optional(),
  /** Its own section order (#297); absent in files before version 9, which follow the base resume. */
  sections: z.unknown().nullable().optional(),
  /** What it was sent with (#299); absent in files before version 9, and made after importing them. */
  frozen: z.unknown().nullable().optional(),
  /** The job agent's (E16); absent in older files, which hold only the user's own. */
  origin: z.enum(ApplicationOrigin).optional(),
  agentScore: int.nullable().optional(),
  /** The tailored resume's score (#370); absent in files before version 10. */
  resumeFit: z.unknown().nullable().optional(),
  awaitingReview: z.boolean().optional(),
  archivedAt: optionalDate,
  createdAt: date,
  updatedAt: date,
  events: z.array(statusEvent),
  documents: z.array(document),
  messages: z.array(chatMessage),
  notes: z.array(note),
  /** Absent in files before version 4. */
  facts: z.array(fact).default([]),
  /** "I don't have this" (E30-5); absent in files before version 14. */
  knownGaps: z.array(z.object({ id: text, requirement: text, createdAt: date })).default([]),
  /** Its offer (E30-7); absent in files before version 15. */
  offer: z
    .object({
      id: text,
      salary: text,
      decideBy: date.nullable(),
      startDate: date.nullable(),
      holidays: text,
      office: text,
      fromEmailId: text.nullable(),
      createdAt: date,
      updatedAt: date,
    })
    .nullable()
    .optional(),
  /** Its interview rounds (E30-6); absent in files before version 15. */
  interviews: z
    .array(
      z.object({
        id: text,
        round: z.number().int().min(1),
        at: date.nullable(),
        minutes: z.number().int().nullable(),
        place: text,
        people: text,
        notes: text,
        prep: z.unknown().nullable().optional(),
        prepWrittenWith: text.nullable(),
        createdAt: date,
        updatedAt: date,
      }),
    )
    .default([]),
});

/** A posting the job agent found (E16). */
const agentCandidate = z.object({
  id: text,
  source: sourceIdSchema,
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
  // Coverage (E32-2, version 16); 0 of 0 in files from before.
  covered: int.default(0),
  requirements: int.default(0),
  mustMissing: int.default(0),
  // Why a run skipped it (E32-5); null in files from before.
  skipReason: text.nullable().default(null),
  reasons: z.unknown().nullable(),
  redFlags: z.unknown().nullable(),
  status: z.enum(AgentCandidateStatus),
  error: text.nullable(),
  applicationId: text.nullable(),
  dedupeKey: text,
  createdAt: date,
  updatedAt: date,
});

const agentSearch = agentSearchInputSchema.extend({ id: text.min(1), createdAt: date, updatedAt: date });
const agentCandidateSearch = z.object({
  id: text.min(1), candidateId: text.min(1), searchId: text.min(1).nullable(), searchName: text, createdAt: date,
});

/** A startup from Startups (#222), with the addresses it publishes and what the user did with it. */
const startup = z.object({
  id: text,
  source: text,
  externalId: text,
  company: text,
  website: text,
  summary: text,
  details: text,
  location: text,
  remote: z.boolean().nullable(),
  stage: text,
  roles: z.unknown().nullable(),
  emails: z.unknown().nullable(),
  links: z.unknown().nullable(),
  postedAt: optionalDate,
  score: int,
  reasons: z.unknown().nullable(),
  /** The profile it fits best (E24-6); absent in files before version 13. */
  profileId: text.nullable().optional(),
  scoredWith: text,
  status: z.enum(StartupStatus),
  noApplicationsFrom: text,
  emailsCheckedAt: optionalDate,
  peopleCheckedAt: optionalDate,
  notes: text,
  seenAt: date,
  applicationId: text.nullable(),
  createdAt: date,
  updatedAt: date,
});

/** A posting kept from Find jobs (E14-5). */
const posting = z.object({
  id: text,
  source: sourceIdSchema,
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
  /** From version 12 (E22-5); before, every posting in a file was kept, so seen, and last found when it was kept. */
  lastFoundAt: optionalDate.optional(),
  seenAt: optionalDate.optional(),
  /** From version 12 (E22-6): the posting it shows as, the same job found on another portal. */
  mergedIntoId: text.nullable().optional(),
  /** From version 12 (E22-7): in the Archive since, moved back from it, removed from it. */
  archivedAt: optionalDate.optional(),
  movedBackAt: optionalDate.optional(),
  removedAt: optionalDate.optional(),
  createdAt: date,
  updatedAt: date,
});

/** A search kept (E14-10). Before version 12 it held what it found as JSON, moved into the library on import. */
const postingSearch = z.object({
  id: text,
  source: sourceIdSchema.nullable(),
  query: z.unknown(),
  postings: z.unknown().optional(),
  /** From version 12: each portal it asked (searchPortalSchema), checked when it's opened. */
  portals: z.unknown().optional(),
  found: int,
  next: text.nullable().optional(),
  /** From version 12 (E22-8): the job agent's search it ran for, and that search's name then. */
  agentSearchId: text.nullable().optional(),
  agentSearchName: text.nullable().optional(),
  createdAt: date,
  updatedAt: date,
});

/** An export file as read back (E10-6). */
export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.literal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
  appVersion: text,
  exportedAt: date,
  /** From version 13 (E24-1): every profile; the rows below say whose they are. Before, one profile, made from the headline, summary and Base resume settings. */
  profiles: z.array(profileRow).optional(),
  /** The shared basics, languages and facts, and every profile's rows. */
  profile: z.object({
    fields: z.array(keyValue),
    skills: z.array(skill),
    languages: z.array(language),
    experience: z.array(experience),
    /** Absent in files before version 3. */
    projects: z.array(project).default([]),
    education: z.array(education),
    /** Absent in files before version 8. */
    certifications: z.array(certification).default([]),
    /** Absent in files before version 9. */
    customSections: z.array(customSection).default([]),
    /** Absent in files before version 5. */
    publications: z.array(publication).default([]),
    references: z.array(reference),
    /** Absent in files before version 4. */
    facts: z.array(fact).default([]),
  }),
  themes: z.array(theme),
  settings: z.array(keyValue),
  /** The AI provider's key in plain text, only when the user asked for it. */
  apiKey: text.optional(),
  /** The job sources' keys in plain text, likewise (E14-9). */
  /** Before version 12: the JSearch and Adzuna keys. */
  jobSourceKeys: z.object({ jsearch: text.optional(), adzuna: text.optional() }).optional(),
  /** From version 12 (E22-3): each portal's secret fields, by portal and field, when keys are included. */
  portalKeys: z.record(z.string().max(40), z.record(z.string().max(40), text)).optional(),
  applications: z.array(application),
  /** Saved and dismissed postings (E14-9); absent in version 1 files. */
  postings: z.array(posting).default([]),
  /** Past searches with what they found (E14-10); absent in version 1 files. */
  searches: z.array(postingSearch).default([]),
  /** From version 12 (E22-5): which search found which posting, on which portal. */
  postingFinds: z.array(z.object({ id: text, postingId: text, searchId: text, portal: sourceIdSchema, foundAt: date })).default([]),
  /** The job agent's candidates (E16); absent in older files. */
  agentCandidates: z.array(agentCandidate).default([]),
  agentSearches: z.array(agentSearch).max(MAX_AGENT_SEARCHES, "Keep at most three Agent searches.").default([]),
  agentCandidateSearches: z.array(agentCandidateSearch).default([]),
  /** Startups (#222), and hashes of the ones removed for good; absent in older files. */
  startups: z.array(startup).default([]),
  startupBlocks: z.array(z.object({ hash: text, createdAt: date })).default([]),
  /** From version 12 (E23-3): the portals the user added, each config as installed. A config that no longer reads is skipped on import. */
  installedPortals: z
    .array(z.object({ id: text, config: z.unknown(), version: text, origin: z.enum(["file", "link", "catalog"]), originUrl: text.nullable(), reviewed: z.boolean(), installedAt: date, updatedAt: date }))
    .default([]),
  /** Notification channels and which events each gets (E26-2, E26-3), never their secrets; absent before version 13. */
  notificationChannels: z
    .array(
      z.object({
        id: text,
        type: z.enum(NotificationChannelType),
        name: text,
        config: z.unknown(),
        events: z.record(z.string(), z.boolean()).default({}),
        onlyNew: z.boolean().default(true),
        sort: int.default(0),
        createdAt: date,
        updatedAt: date,
      }),
    )
    .default([]),
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
    const [profiles, fields, skills, languages, experience, projects, education, certifications, customSections, publications, references, facts, themes, settings, applications, postings, searches, postingFinds, agentCandidates, agentSearches, agentCandidateSearches, startups, startupBlocks] = await Promise.all([
      tx.profile.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
      tx.profileField.findMany({ select: { key: true, value: true }, orderBy: { key: "asc" } }),
      tx.skill.findMany({ select: { id: true, profileId: true, name: true, sort: true, group: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
      tx.language.findMany({ select: { id: true, name: true, level: true, sort: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
      tx.experience.findMany({ include: { skills: { select: { skillId: true } } }, orderBy: { createdAt: "asc" } }),
      tx.project.findMany({ include: { skills: { select: { skillId: true } } }, orderBy: { createdAt: "asc" } }),
      tx.education.findMany({ orderBy: { createdAt: "asc" } }),
      tx.certification.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
      tx.customSection.findMany({ orderBy: { createdAt: "asc" }, include: { items: { omit: { sectionId: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] } } }),
      tx.publication.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
      tx.reference.findMany({ orderBy: { createdAt: "asc" } }),
      tx.fact.findMany({ where: { applicationId: null }, omit: { applicationId: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
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
          facts: { omit: { applicationId: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] },
          knownGaps: { omit: { applicationId: true }, orderBy: { createdAt: "asc" } },
          interviews: { omit: { applicationId: true }, orderBy: { round: "asc" } },
          offer: { omit: { applicationId: true } },
        },
      }),
      // Its company key is worked out again on import (fillMatchKeys).
      tx.posting.findMany({ orderBy: { createdAt: "asc" }, omit: { matchCompany: true } }),
      tx.postingSearch.findMany({ orderBy: { createdAt: "asc" } }),
      tx.postingFind.findMany({ orderBy: [{ foundAt: "asc" }, { id: "asc" }] }),
      tx.agentCandidate.findMany({ orderBy: { createdAt: "asc" } }),
      tx.agentSearch.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
      tx.agentCandidateSearch.findMany({ orderBy: { createdAt: "asc" } }),
      tx.startup.findMany({ orderBy: { createdAt: "asc" } }),
      tx.startupBlock.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    const installedPortals = await tx.installedPortal.findMany({ orderBy: { installedAt: "asc" } });
    // Without their secrets, their failures or whether they're paused: those belong to this install.
    const notificationChannels = await tx.notificationChannel.findMany({
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      select: { id: true, type: true, name: true, config: true, events: true, onlyNew: true, sort: true, createdAt: true, updatedAt: true },
    });

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
    const portalKeys = Object.fromEntries(
      includeApiKey
        ? Object.entries(savedPortalKeys(settingsFromRows(settings)))
            .map(([portal, fields]) => [
              portal,
              Object.fromEntries(Object.entries(fields).flatMap(([field, value]) => {
                const plain = readable(value, (stored) => decryptSecret(JOB_SOURCE_KEY, stored));
                return plain ? [[field, plain]] : [];
              })),
            ] as const)
            .filter(([, fields]) => Object.keys(fields).length > 0)
        : [],
    );

    return {
      format: EXPORT_FORMAT,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      appVersion,
      exportedAt: now,
      profiles: profiles.map((entry) => ({ ...entry, settings: storedSettings(entry.settings), workplace: workplaceFrom(entry.workplace) })),
      profile: {
        fields,
        skills,
        languages,
        experience: experience.map(({ skills: links, ...entry }) => ({ ...entry, skillIds: links.map((link) => link.skillId) })),
        projects: projects.map(({ skills: links, ...entry }) => ({ ...entry, skillIds: links.map((link) => link.skillId) })),
        education,
        certifications,
        customSections,
        publications,
        references,
        facts,
      },
      themes,
      settings: settings.filter((setting) => setting.key !== "agentQuery" && !SECRET_SETTINGS.includes(setting.key) && !INSTALL_SETTINGS.includes(setting.key)),
      ...(apiKey ? { apiKey } : {}),
      ...(Object.keys(portalKeys).length > 0 ? { portalKeys } : {}),
      applications,
      postings,
      searches,
      postingFinds,
      agentCandidates,
      agentSearches: agentSearches.map((search) => ({ ...search, ...agentSearchInputSchema.parse(search) })),
      agentCandidateSearches,
      startups,
      startupBlocks,
      installedPortals: installedPortals.map((portal) => ({ ...portal, origin: portal.origin as "file" | "link" | "catalog" })),
      notificationChannels: notificationChannels.map((channel) => ({ ...channel, events: channelEventsOf(channel.events) })),
    };
  });
}

/** A channel's events column as on or off by name; anything else in it is left out. */
function channelEventsOf(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

/** A profile's `settings` column as text by key; anything else in it is left out. */
function storedSettings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
