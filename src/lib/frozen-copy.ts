import "server-only";

import { z } from "zod";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  CustomSectionCountsAs, CustomSectionFormat,
  DateFormat,
  DateStyle,
  Density,
  DocumentKind,
  HeaderStyle,
  HeadingStyle,
  LanguageLevel,
  PaperSize,
  PhotoPosition,
  PhotoShape,
  SidebarStyle,
  ThemeAlign,
  ThemeFont,
  ThemeLayout,
} from "@/generated/prisma/enums";
import { extractedSchema } from "@/lib/application-data";
import { prisma } from "@/lib/prisma";
import { BASICS_FIELDS, type Basics, type ProfileData } from "@/lib/profile";
import { loadProfile } from "@/lib/profile-data";
import type { ProfileSettings } from "@/lib/profile-settings";
import { loadProfileSettings } from "@/lib/profiles";
import { sectionOfUnit } from "@/lib/resume-sections";
import { THEME_STYLE_DEFAULTS, BUILT_IN_THEMES, type ThemeData } from "@/lib/themes";
import { loadSettings } from "@/lib/settings-data";
import { THEME_FIELDS } from "@/lib/theme-data";

// A resume that was sent stays the resume that was sent (#299). A tailored
// document only stores its text, with titles, dates, contact details and the
// theme read when it's drawn. So on its first send, an application keeps its
// own copy of those, and is drawn from the copy from then on. Only what's done
// to the application itself changes it. The photo stays live: at its size, a
// copy per application could soon push an export past the import limit.

type Db = PrismaClient | Prisma.TransactionClient;

const text = z.string().default("");
const list = <T extends z.ZodType>(item: T) => z.array(item).default([]);
const when = { startYear: z.number().nullable().default(null), startMonth: z.number().nullable().default(null), endYear: z.number().nullable().default(null), endMonth: z.number().nullable().default(null), current: z.boolean().default(false) };

/**
 * The profile as a copy holds it. Every field has a default, so a copy made
 * by an older version keeps reading when the profile gains a field: add new
 * fields here, with one. `satisfies` below fails the build otherwise.
 */
const frozenProfileSchema = z.object({
  basics: z.record(z.string(), z.unknown()).transform((raw): Basics => ({
    ...(Object.fromEntries(BASICS_FIELDS.map((field) => [field, typeof raw[field] === "string" ? raw[field] : ""])) as Record<(typeof BASICS_FIELDS)[number], string>),
    showAge: raw.showAge === true,
  })),
  skills: list(z.object({ id: z.string(), name: text, group: text })),
  languages: list(z.object({ id: z.string(), name: text, level: z.enum(LanguageLevel) })),
  experience: list(z.object({ id: z.string(), role: text, company: text, location: text, descriptor: text, volunteering: z.boolean().default(false), bullets: text, skillIds: z.array(z.string()).default([]), ...when })),
  projects: list(z.object({ id: z.string(), name: text, link: text, bullets: text, skillIds: z.array(z.string()).default([]), ...when })),
  education: list(z.object({ id: z.string(), degree: text, school: text, notes: text, ...when })),
  certifications: list(
    z.object({
      id: z.string(),
      name: text,
      issuer: text,
      year: z.number().nullable().default(null),
      month: z.number().nullable().default(null),
      expiryYear: z.number().nullable().default(null),
      expiryMonth: z.number().nullable().default(null),
      credentialId: text,
      link: text,
      onResumes: z.boolean().default(true),
    }),
  ),
  publications: list(z.object({ id: z.string(), citation: text, link: text, onResumes: z.boolean().default(true) })),
  references: list(z.object({ id: z.string(), name: text, relation: text, company: text, email: text, phone: text })),
  customSections: list(
    z.object({
      id: z.string(),
      title: text,
      format: z.enum(CustomSectionFormat),
      // Copies made before E24-5 say nothing: every section was Extra activities then.
      countsAs: z.enum(CustomSectionCountsAs).catch("EXTRA_ACTIVITIES"),
      items: list(z.object({ id: z.string(), title: text, subtitle: text, details: text, link: text, onResumes: z.boolean().default(true), ...when })),
    }),
  ),
  facts: list(z.object({ id: z.string(), text })),
}) satisfies z.ZodType<Omit<ProfileData, "photo">, unknown>;

/** A theme as a copy holds it. One that no longer reads gives way to the document's own. */
const frozenTheme = z
  .object({
    id: z.string(),
    name: z.string(),
    builtIn: z.boolean(),
    headFont: z.enum(ThemeFont),
    bodyFont: z.enum(ThemeFont),
    accent: z.string(),
    layout: z.enum(ThemeLayout),
    align: z.enum(ThemeAlign),
    headingStyle: z.enum(HeadingStyle),
    density: z.enum(Density),
    headerStyle: z.enum(HeaderStyle).default(THEME_STYLE_DEFAULTS.headerStyle),
    sidebarStyle: z.enum(SidebarStyle).default(THEME_STYLE_DEFAULTS.sidebarStyle),
    dateStyle: z.enum(DateStyle).default(THEME_STYLE_DEFAULTS.dateStyle),
    photoShape: z.enum(PhotoShape).default(THEME_STYLE_DEFAULTS.photoShape),
    photoPosition: z.enum(PhotoPosition).default(THEME_STYLE_DEFAULTS.photoPosition),
  })
  .nullable()
  .catch(null) satisfies z.ZodType<ThemeData | null, unknown>;

export const frozenCopySchema = z.object({
  profile: frozenProfileSchema,
  themes: z.object({ RESUME: frozenTheme, COVER_LETTER: frozenTheme }),
  paper: z.enum(PaperSize),
  dateFormat: z.enum(DateFormat),
  includeReferences: z.boolean(),
  /** It was following the base resume's sections, so undoing the send can put that back. */
  followedBase: z.boolean(),
});
export type FrozenCopy = z.infer<typeof frozenCopySchema>;

/** An application's copy, or null while it has none. */
export function readFrozenCopy(value: unknown): FrozenCopy | null {
  const parsed = frozenCopySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The copy's profile with today's photo. */
export const frozenProfile = (copy: FrozenCopy, live: ProfileData): ProfileData => ({ ...copy.profile, photo: live.photo });

/** The profile an application is written and drawn from: its copy once it was sent, for the AI too; else its own profile now (E24-6). */
export async function profileOfApplication(frozen: unknown, profileId?: string | null): Promise<ProfileData> {
  const [live, copy] = [await loadProfile(profileId), readFrozenCopy(frozen)];
  return copy ? frozenProfile(copy, live) : live;
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

type Shared = { profile: ProfileData; settings: Awaited<ReturnType<typeof loadSettings>>; own: ProfileSettings; baseTheme: ThemeData };

/** What a send freezes from the application's profile (E24-6) and the settings. */
async function loadShared(db: Db, profileId: string | null): Promise<Shared> {
  const [profile, settings, own] = await Promise.all([loadProfile(profileId, db), loadSettings(db), loadProfileSettings(profileId, db)]);
  const baseTheme = (await db.theme.findUnique({ where: { id: own.baseThemeId }, select: THEME_FIELDS })) ?? BUILT_IN_THEMES[0];
  return { profile, settings, own, baseTheme };
}

/** What to write on an application to freeze it. */
async function frozenData(db: Db, applicationId: string, { profile, settings, own, baseTheme }: Shared) {
  const application = await db.application.findUniqueOrThrow({
    where: { id: applicationId },
    select: { sections: true, extracted: true, documents: { select: { kind: true, theme: { select: THEME_FIELDS } } } },
  });
  const themeOf = (kind: DocumentKind) => application.documents.find((document) => document.kind === kind)?.theme ?? baseTheme;
  const extracted = extractedSchema.safeParse(application.extracted);
  const copy: FrozenCopy = {
    // The schema keeps what it knows, which leaves out the photo.
    profile: frozenProfileSchema.parse(profile),
    themes: { RESUME: themeOf(DocumentKind.RESUME), COVER_LETTER: themeOf(DocumentKind.COVER_LETTER) },
    paper: settings.paper,
    dateFormat: settings.dateFormat,
    includeReferences: settings.includeRefs && extracted.success && extracted.data.asksForReferences === true,
    followedBase: application.sections === null,
  };
  return { frozen: asJson(copy), sections: application.sections === null ? asJson(own.resumeSections) : asJson(application.sections) };
}

/** On an application's first send. */
export async function frozenDataForSend(db: Db, applicationId: string) {
  const { profileId } = await db.application.findUniqueOrThrow({ where: { id: applicationId }, select: { profileId: true } });
  return frozenData(db, applicationId, await loadShared(db, profileId));
}

/** Undoing that send: it follows the profile again, and the base resume's sections if it did. */
export function unfrozenData(frozen: unknown) {
  const copy = readFrozenCopy(frozen);
  return { frozen: Prisma.DbNull, ...(copy?.followedBase ? { sections: Prisma.DbNull } : {}) };
}

/**
 * Freezes the applications sent without one: those sent before this version,
 * at the first start after the upgrade, and those in an older export file, after
 * importing it. They keep what they show now; earlier changes can't be undone.
 */
export async function freezeSentApplications(db: Db = prisma): Promise<number> {
  const sent = await db.application.findMany({ where: { sentAt: { not: null }, frozen: { equals: Prisma.DbNull } }, select: { id: true, profileId: true } });
  if (sent.length === 0) return 0;
  // Each from its own profile, read once for all its applications.
  const shared = new Map<string | null, Shared>();
  for (const { id, profileId } of sent) {
    if (!shared.has(profileId)) shared.set(profileId, await loadShared(db, profileId));
    await db.application.update({ where: { id }, data: await frozenData(db, id, shared.get(profileId)!) });
  }
  return sent.length;
}

/**
 * The copy with one section brought in from the current profile: adding a
 * section to a sent resume is the one way the profile reaches it, along with
 * any skills that section's roles or projects name.
 */
export function withSectionFromProfile(copy: FrozenCopy, live: ProfileData, key: string): FrozenCopy {
  const profile = { ...copy.profile };
  const fromLive = (unitId: string) => sectionOfUnit(unitId, live) === key;
  if (key === "summary") profile.basics = { ...profile.basics, summary: live.basics.summary };
  if (key === "skills") profile.skills = live.skills;
  if (key === "languages") profile.languages = live.languages;
  if (key === "experience" || key === "volunteering") {
    const isKey = (entry: { volunteering: boolean }) => entry.volunteering === (key === "volunteering");
    profile.experience = [...profile.experience.filter((entry) => !isKey(entry)), ...live.experience.filter(isKey)];
  }
  if (key === "projects") profile.projects = live.projects;
  if (key === "education") profile.education = live.education;
  if (key === "certifications") profile.certifications = live.certifications;
  if (key === "publications") profile.publications = live.publications;
  if (key === "references") profile.references = live.references;
  const section = live.customSections.find((entry) => fromLive(`custom-inline:${entry.id}`));
  if (section) profile.customSections = [...profile.customSections.filter((entry) => entry.id !== section.id), section];

  // A role's or project's skills are drawn by name: the copy needs the ones it hasn't got.
  const known = new Set(profile.skills.map((skill) => skill.id));
  const named = new Set([...profile.experience, ...profile.projects].flatMap((entry) => entry.skillIds));
  profile.skills = [...profile.skills, ...live.skills.filter((skill) => named.has(skill.id) && !known.has(skill.id))];
  return { ...copy, profile };
}
