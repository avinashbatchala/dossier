import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { countryCodeFor } from "@/lib/job-search/countries";
import type { SearchQuery } from "@/lib/job-search/search";
import { basicsFromFields, profileStrength } from "@/lib/profile";
import { levelRange, type LevelRange } from "@/lib/profile-levels";
import { workplaceFrom, type Workplace } from "@/lib/profile-workplace";
import { profileSettingsFrom, profileSettingValues, type ProfileSettings } from "@/lib/profile-settings";
import { DEFAULT_BASE_THEME } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The profiles (E24-1, #402): each a resume of its own, sharing only the
// basics. There is always at least one; the first (lowest sort, then oldest)
// is the one used wherever none is chosen.

type Db = PrismaClient | Prisma.TransactionClient;

/** A profile as lists and switchers show it. */
export type ProfileSummary = { id: string; name: string };

/** The name a profile gets when nothing better is known. */
export const DEFAULT_PROFILE_NAME = "My profile";

const ORDER = [{ sort: "asc" as const }, { createdAt: "asc" as const }];

/** The first profile's id, making it when there's none (after Delete everything, or an import that brought none). */
export async function firstProfileId(db: Db = prisma): Promise<string> {
  const first = await db.profile.findFirst({ orderBy: ORDER, select: { id: true } });
  if (first) return first.id;
  return (await db.profile.create({ data: { name: DEFAULT_PROFILE_NAME }, select: { id: true } })).id;
}

/** The profile asked for when it exists, else the first. */
export async function profileIdOr(id: string | null | undefined, db: Db = prisma): Promise<string> {
  if (id && (await db.profile.findUnique({ where: { id }, select: { id: true } }))) return id;
  return firstProfileId(db);
}

/** Every profile, first first. */
export async function listProfiles(db: Db = prisma): Promise<ProfileSummary[]> {
  await firstProfileId(db);
  return db.profile.findMany({ orderBy: ORDER, select: { id: true, name: true } });
}

/** A profile as the sidebar lists it (E27-5): with its strength, 0 to 100. */
export type SidebarProfile = ProfileSummary & { strength: number };

/**
 * Every profile with its strength (PRO-9), for the sidebar: the shared
 * basics once, and each profile's paid roles, education and skills counted
 * in one query each, not a whole profile per row.
 */
export async function loadSidebarProfiles(db: Db = prisma): Promise<SidebarProfile[]> {
  await firstProfileId(db);
  const [profiles, fields, roles, education, skills] = await Promise.all([
    db.profile.findMany({ orderBy: ORDER, select: { id: true, name: true, headline: true, summary: true } }),
    db.profileField.findMany({ select: { key: true, value: true } }),
    db.experience.groupBy({ by: ["profileId"], where: { volunteering: false }, _count: { _all: true } }),
    db.education.groupBy({ by: ["profileId"], _count: { _all: true } }),
    db.skill.groupBy({ by: ["profileId"], _count: { _all: true } }),
  ]);
  const shared = basicsFromFields(fields);
  const counted = (groups: { profileId: string; _count: { _all: number } }[]) => new Map(groups.map((group) => [group.profileId, group._count._all]));
  const [roleCounts, educationCounts, skillCounts] = [counted(roles), counted(education), counted(skills)];
  return profiles.map(({ id, name, headline, summary }) => ({
    id,
    name,
    strength: profileStrength({
      basics: { ...shared, headline, summary },
      experience: roleCounts.get(id) ?? 0,
      education: educationCounts.get(id) ?? 0,
      skills: skillCounts.get(id) ?? 0,
    }).percent,
  }));
}

/**
 * The profile a connector tool asked for (E24-6), by its id or its name
 * (any case), or the first when none was given; an error naming them all
 * when it's unknown.
 */
export async function profileNamed(asked: string | undefined, db: Db = prisma): Promise<ProfileSummary | { error: string }> {
  const profiles = await listProfiles(db);
  const wanted = asked?.trim();
  if (!wanted) return profiles[0];
  const found = profiles.find((profile) => profile.id === wanted) ?? profiles.find((profile) => profile.name.trim().toLowerCase() === wanted.toLowerCase());
  return found ?? { error: `There's no profile called "${wanted}". The profiles are: ${profiles.map((profile) => `"${profile.name}"`).join(", ")}.` };
}

/**
 * A profile's settings (its Base resume and entry orders). Nothing in the
 * database ties the theme to its row, so a deleted custom theme reads as
 * Editorial here.
 */
export async function loadProfileSettings(profileId?: string | null, db: Db = prisma): Promise<ProfileSettings> {
  const id = await profileIdOr(profileId, db);
  const row = await db.profile.findUniqueOrThrow({ where: { id }, select: { settings: true } });
  const settings = profileSettingsFrom(row.settings);
  if (settings.baseThemeId !== DEFAULT_BASE_THEME && !(await db.theme.findUnique({ where: { id: settings.baseThemeId }, select: { id: true } }))) {
    return { ...settings, baseThemeId: DEFAULT_BASE_THEME };
  }
  return settings;
}

/** Saves some of a profile's settings; null forgets one, so it reads as its default. */
export async function saveProfileSettings(profileId: string, changes: Partial<ProfileSettings>, db: Db = prisma): Promise<void> {
  const row = await db.profile.findUniqueOrThrow({ where: { id: profileId }, select: { settings: true } });
  await db.profile.update({ where: { id: profileId }, data: { settings: profileSettingValues(row.settings, changes) } });
}

/**
 * The profile Profile and Base resume show (E24-2): the one asked for, which
 * is then remembered, or else the last one opened, or else the first.
 */
export async function openProfileId(asked?: string | null, db: Db = prisma): Promise<string> {
  const { openProfileId: remembered } = await loadSettings(db);
  if (asked && (await db.profile.findUnique({ where: { id: asked }, select: { id: true } }))) {
    if (remembered !== asked) await saveSettings({ openProfileId: asked });
    return asked;
  }
  return profileIdOr(remembered, db);
}

/** A sort value after every profile's, so a new one goes last. */
async function nextProfileSort(db: Db): Promise<number> {
  return ((await db.profile.aggregate({ _max: { sort: true } }))._max.sort ?? -1) + 1;
}

/** A new, empty profile, last in the list, with the levels it's for when they're known (E24-3). */
export async function createProfile(name: string, levels: LevelRange | null = null, db: Db = prisma): Promise<string> {
  return (await db.profile.create({ data: { name, sort: await nextProfileSort(db), levelFrom: levels?.from, levelTo: levels?.to }, select: { id: true } })).id;
}

/** A profile's levels (E24-3); null until they're chosen. */
export async function loadProfileLevels(profileId?: string | null, db: Db = prisma): Promise<LevelRange | null> {
  const row = await db.profile.findUnique({ where: { id: await profileIdOr(profileId, db) }, select: { levelFrom: true, levelTo: true } });
  return row ? levelRange(row.levelFrom, row.levelTo) : null;
}

/** Where a profile wants to work (E24-4), and whether the user has looked at it yet. */
export async function loadProfileWorkplace(profileId?: string | null, db: Db = prisma): Promise<{ workplace: Workplace; seen: boolean }> {
  const row = await db.profile.findUniqueOrThrow({ where: { id: await profileIdOr(profileId, db) }, select: { workplace: true, workplaceSeenAt: true } });
  return { workplace: workplaceFrom(row.workplace), seen: row.workplaceSeenAt !== null };
}

/** Saves the answers; looking at them counts as seen too. False when the profile is gone. */
export async function saveProfileWorkplace(profileId: string, workplace: Workplace, db: Db = prisma): Promise<boolean> {
  return (await db.profile.updateMany({ where: { id: profileId }, data: { workplace, workplaceSeenAt: new Date() } })).count > 0;
}

/** The user has looked at where the profile wants to work: the Profile page stops asking. */
export async function markWorkplaceSeen(profileId: string, db: Db = prisma): Promise<void> {
  await db.profile.updateMany({ where: { id: profileId, workplaceSeenAt: null }, data: { workplaceSeenAt: new Date() } });
}

export async function saveProfileLevels(profileId: string, levels: LevelRange, db: Db = prisma): Promise<boolean> {
  return (await db.profile.updateMany({ where: { id: profileId }, data: { levelFrom: levels.from, levelTo: levels.to } })).count > 0;
}

/** Why scoring against a profile has to wait (E24-3, M5a): its levels aren't chosen yet. Null when it can go ahead. */
export type LevelsProblem = { profileId: string; name: string; message: string; href: string };

export async function levelsProblem(profileId?: string | null, db: Db = prisma): Promise<LevelsProblem | null> {
  const id = await profileIdOr(profileId, db);
  const row = await db.profile.findUniqueOrThrow({ where: { id }, select: { name: true, levelFrom: true, levelTo: true } });
  if (levelRange(row.levelFrom, row.levelTo)) return null;
  return { profileId: id, name: row.name, message: `Set the levels for “${row.name}” first.`, href: `/profile?section=target&profile=${id}` };
}

/**
 * Why Score has to wait (E24-3): the asked profile's levels aren't chosen,
 * or, with all of them (`"all"`), no profile's are. Null when it can go ahead.
 */
export async function scoreLevelsProblem(profiles: string | undefined, db: Db = prisma): Promise<LevelsProblem | null> {
  if (profiles !== "all") return levelsProblem(profiles, db);
  const waiting = await Promise.all((await listProfiles(db)).map((profile) => levelsProblem(profile.id, db)));
  return waiting.every(Boolean) ? waiting[0]! : null;
}

/**
 * A copy of a profile under a new name (E24-2): its headline, summary and
 * settings, and every one of its rows, each with an id of its own and the
 * same creation time, which orders custom sections and breaks ties in sort.
 * Skills stay attached to the copied roles and projects; a custom section
 * keeps what it counts as.
 */
export async function copyProfile(fromId: string, name: string, db: PrismaClient = prisma): Promise<string> {
  return db.$transaction(async (tx) => {
    const from = await tx.profile.findUniqueOrThrow({ where: { id: fromId } });
    const own = { where: { profileId: fromId } };
    const [skills, experience, projects, education, certifications, publications, references, customSections] = await Promise.all([
      tx.skill.findMany(own),
      tx.experience.findMany({ ...own, include: { skills: { select: { skillId: true } } } }),
      tx.project.findMany({ ...own, include: { skills: { select: { skillId: true } } } }),
      tx.education.findMany(own),
      tx.certification.findMany(own),
      tx.publication.findMany(own),
      tx.reference.findMany(own),
      tx.customSection.findMany({ ...own, include: { items: true } }),
    ]);
    const { id: profileId } = await tx.profile.create({
      data: { name, sort: await nextProfileSort(tx), headline: from.headline, summary: from.summary, levelFrom: from.levelFrom, levelTo: from.levelTo, workplace: from.workplace ?? {}, workplaceSeenAt: from.workplaceSeenAt, settings: from.settings ?? {} },
      select: { id: true },
    });
    const copied = <T extends { id: string; profileId: string; updatedAt?: Date }>(row: T) => {
      const rest: Partial<T> = { ...row };
      delete rest.id;
      delete rest.updatedAt;
      return { ...rest, profileId } as Omit<T, "id" | "updatedAt">;
    };
    const skillIds = new Map<string, string>();
    const renamed = new Map<string, string>();
    for (const skill of skills) skillIds.set(skill.id, (await tx.skill.create({ data: copied(skill), select: { id: true } })).id);
    const links = (entry: { skills: { skillId: string }[] }) => entry.skills.flatMap((link) => (skillIds.has(link.skillId) ? [{ skillId: skillIds.get(link.skillId)! }] : []));
    for (const { skills: used, ...role } of experience) await tx.experience.create({ data: { ...copied(role), skills: { create: links({ skills: used }) } } });
    for (const { skills: used, ...project } of projects) await tx.project.create({ data: { ...copied(project), skills: { create: links({ skills: used }) } } });
    await tx.education.createMany({ data: education.map(copied) });
    await tx.certification.createMany({ data: certifications.map(copied) });
    await tx.publication.createMany({ data: publications.map(copied) });
    await tx.reference.createMany({ data: references.map(copied) });
    for (const { items, ...section } of customSections) {
      // The Base resume's order and headings name custom sections by id: the copy's point at its own.
      const itemData = items.map((item) => ({
        title: item.title,
        subtitle: item.subtitle,
        startYear: item.startYear,
        startMonth: item.startMonth,
        endYear: item.endYear,
        endMonth: item.endMonth,
        current: item.current,
        details: item.details,
        link: item.link,
        onResumes: item.onResumes,
        sort: item.sort,
        createdAt: item.createdAt,
      }));
      const created = await tx.customSection.create({ data: { ...copied(section), items: { create: itemData } }, select: { id: true } });
      renamed.set(section.id, created.id);
    }
    if (renamed.size > 0) {
      const settings = profileSettingsFrom(from.settings);
      const key = (old: string) => (old.startsWith("custom:") && renamed.has(old.slice(7)) ? `custom:${renamed.get(old.slice(7))}` : old);
      const layout = settings.resumeSections;
      await saveProfileSettings(
        profileId,
        {
          resumeSections: {
            ...layout,
            order: layout.order.map(key),
            off: layout.off.map(key),
            ...(layout.titles ? { titles: Object.fromEntries(Object.entries(layout.titles).map(([section, title]) => [key(section), title])) } : {}),
          },
        },
        tx,
      );
    }
    return profileId;
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Renames a profile; false when it's gone. */
export async function renameProfile(id: string, name: string, db: Db = prisma): Promise<boolean> {
  return (await db.profile.updateMany({ where: { id }, data: { name } })).count > 0;
}

/**
 * Deletes a profile with everything that's its own; the last one stays,
 * since there's always one. Applications keep their own documents.
 */
export async function deleteProfile(id: string, db: PrismaClient = prisma): Promise<"deleted" | "last" | "gone"> {
  return db.$transaction(async (tx) => {
    if (!(await tx.profile.findUnique({ where: { id }, select: { id: true } }))) return "gone";
    if ((await tx.profile.count()) <= 1) return "last";
    // Its agent searches go on with the first of the others (E24-6); its applications keep their documents.
    const next = await tx.profile.findFirst({ where: { id: { not: id } }, orderBy: ORDER, select: { id: true } });
    await tx.agentSearch.updateMany({ where: { profileId: id }, data: { profileId: next!.id } });
    await tx.profile.delete({ where: { id } });
    return "deleted";
  });
}

/**
 * What an agent search tied to a profile starts with (E24-6): its levels,
 * the shared city and country, its radius for on-site and hybrid work, and
 * Remote only when that's the only way it works. The user can change them.
 */
export async function profileSearchDefaults(profileId: string, db: Db = prisma): Promise<Partial<SearchQuery>> {
  const [levels, { workplace }, fields] = await Promise.all([
    loadProfileLevels(profileId, db),
    loadProfileWorkplace(profileId, db),
    db.profileField.findMany({ where: { key: { in: ["city", "country"] } } }),
  ]);
  const field = (key: string) => fields.find((row) => row.key === key)?.value.trim() ?? "";
  const country = countryCodeFor(field("country"));
  const remoteOnly = workplace.modes.length === 1 && workplace.modes[0] === "REMOTE";
  return {
    experience: levels?.from ?? "any",
    experienceTo: levels && levels.to !== levels.from ? levels.to : undefined,
    place: remoteOnly ? "" : field("city"),
    ...(country ? { country } : {}),
    radiusKm: remoteOnly ? null : workplace.radiusKm,
    remoteOnly,
  };
}

/** The profile an application was made from (E24-6), or the first when it has none (made before, or its profile was deleted). */
export async function applicationProfileId(applicationId: string, db: Db = prisma): Promise<string> {
  const row = await db.application.findUnique({ where: { id: applicationId }, select: { profileId: true } });
  return profileIdOr(row?.profileId, db);
}
