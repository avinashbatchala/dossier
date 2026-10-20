import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { BASICS_FIELDS, sameName } from "@/lib/profile";
import type { ImportedProfile, ImportMode } from "@/lib/profile-import";
import { settingsFromRows } from "@/lib/settings";
import { saveSettings } from "@/lib/settings-data";

type Tx = Prisma.TransactionClient;

/**
 * Applies an imported profile in one transaction (E4-10). Replace clears the
 * profile first. Merge lets the file win (decided 29 September 2026): its
 * basics overwrite the profile's, and an entry it shares with the profile
 * (the same role and company, project name, degree and school, or reference
 * name) takes
 * what the file says; what the file leaves out is kept. Everything else is
 * added, first in a section ordered by hand, else by date.
 */
export async function applyImportedProfile(db: PrismaClient, profile: ImportedProfile, mode: ImportMode): Promise<void> {
  await db.$transaction(
    async (tx) => {
      if (mode === "replace") {
        await tx.experience.deleteMany();
        await tx.project.deleteMany();
        await tx.education.deleteMany();
        await tx.reference.deleteMany();
        await tx.language.deleteMany();
        await tx.skill.deleteMany();
        await tx.profileField.deleteMany({ where: { key: { in: [...BASICS_FIELDS] } } });
        await saveSettings({ experienceOrder: "date", projectOrder: "date", educationOrder: "date" }, tx);
      }
      const order = settingsFromRows(
        await tx.setting.findMany({ where: { key: { in: ["experienceOrder", "projectOrder", "educationOrder"] } } }),
      );

      for (const [key, value] of Object.entries(profile.basics)) {
        await tx.profileField.upsert({ where: { key }, create: { key, value }, update: { value } });
      }

      const skillIds = await applySkills(tx, profile);
      await applyLanguages(tx, profile);

      const nextExperienceSort = await sorter(tx, "experience", order.experienceOrder === "manual");
      const roles = await tx.experience.findMany({ include: { skills: { select: { skillId: true } } } });
      for (const entry of profile.experience) {
        const { skills, ...fields } = withoutFlags(entry);
        const linked = skills.flatMap((name) => skillIds.get(name.toLowerCase()) ?? []);
        const match = roles.find((role) => sameName(role.role, entry.role) && sameName(role.company, entry.company));
        if (match) {
          await tx.experience.update({ where: { id: match.id }, data: filled(fields) });
          const known = new Set(match.skills.map((link) => link.skillId));
          await tx.experienceSkill.createMany({ data: linked.filter((id) => !known.has(id)).map((skillId) => ({ experienceId: match.id, skillId })) });
        } else {
          await tx.experience.create({
            data: { ...fields, sort: nextExperienceSort(), skills: { create: [...new Set(linked)].map((skillId) => ({ skillId })) } },
          });
        }
      }

      const nextProjectSort = await sorter(tx, "project", order.projectOrder === "manual");
      const known = await tx.project.findMany({ include: { skills: { select: { skillId: true } } } });
      for (const entry of profile.projects) {
        const { skills, ...fields } = withoutFlags(entry);
        const linked = skills.flatMap((name) => skillIds.get(name.toLowerCase()) ?? []);
        const match = known.find((project) => sameName(project.name, entry.name));
        if (match) {
          await tx.project.update({ where: { id: match.id }, data: filled(fields) });
          const links = new Set(match.skills.map((link) => link.skillId));
          await tx.projectSkill.createMany({ data: linked.filter((id) => !links.has(id)).map((skillId) => ({ projectId: match.id, skillId })) });
        } else {
          await tx.project.create({
            data: { ...fields, sort: nextProjectSort(), skills: { create: [...new Set(linked)].map((skillId) => ({ skillId })) } },
          });
        }
      }

      const nextEducationSort = await sorter(tx, "education", order.educationOrder === "manual");
      const degrees = await tx.education.findMany();
      for (const fields of profile.education.map(withoutFlags)) {
        const match = degrees.find((degree) => sameName(degree.degree, fields.degree) && sameName(degree.school, fields.school));
        if (match) await tx.education.update({ where: { id: match.id }, data: filled(fields) });
        else await tx.education.create({ data: { ...fields, sort: nextEducationSort() } });
      }

      const references = await tx.reference.findMany();
      let referenceSort = ((await tx.reference.aggregate({ _max: { sort: true } }))._max.sort ?? -1) + 1;
      for (const fields of profile.references.map(withoutFlags)) {
        const match = references.find((reference) => sameName(reference.name, fields.name));
        if (match) await tx.reference.update({ where: { id: match.id }, data: filled(fields) });
        else await tx.reference.create({ data: { ...fields, sort: referenceSort++ } });
      }
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** Finds or creates each skill (names ignore case); answers with the ids by lower-case name. */
async function applySkills(tx: Tx, profile: ImportedProfile): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let sort = ((await tx.skill.aggregate({ _max: { sort: true } }))._max.sort ?? -1) + 1;
  for (const { name } of profile.skills) {
    const skill = (await tx.skill.findUnique({ where: { name } })) ?? (await tx.skill.create({ data: { name, sort: sort++ } }));
    ids.set(name.toLowerCase(), skill.id);
  }
  return ids;
}

/** Adds languages; the file's level wins, unless it didn't give one. */
async function applyLanguages(tx: Tx, profile: ImportedProfile): Promise<void> {
  let sort = ((await tx.language.aggregate({ _max: { sort: true } }))._max.sort ?? -1) + 1;
  for (const { name, level, levelGiven } of profile.languages) {
    const existing = await tx.language.findUnique({ where: { name } });
    if (!existing) await tx.language.create({ data: { name, level, sort: sort++ } });
    else if (levelGiven) await tx.language.update({ where: { id: existing.id }, data: { level } });
  }
}

/** Sort values for new entries: first in an order set by hand, else after the rest. */
async function sorter(tx: Tx, section: "experience" | "project" | "education", manual: boolean): Promise<() => number> {
  const range = { _min: { sort: true }, _max: { sort: true } } as const;
  const { _min, _max } =
    section === "experience"
      ? await tx.experience.aggregate(range)
      : section === "project"
        ? await tx.project.aggregate(range)
        : await tx.education.aggregate(range);
  let first = (_min.sort ?? 1) - 1;
  let last = (_max.sort ?? -1) + 1;
  return manual ? () => first-- : () => last++;
}

/** An entry without the preview's "not in the file" marks. */
function withoutFlags<T extends { unverified: string[] }>(entry: T): Omit<T, "unverified"> {
  const copy: Partial<T> = { ...entry };
  delete copy.unverified;
  return copy as Omit<T, "unverified">;
}

/** The fields the file says something about: empty text and missing dates keep what's there. */
function filled<T extends Record<string, unknown>>(fields: T): Partial<T> {
  const dates = ["startYear", "startMonth", "endYear", "endMonth", "current"];
  const hasDates = fields.startYear !== null && fields.startYear !== undefined;
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => (dates.includes(key) ? hasDates : typeof value === "string" ? value.trim() !== "" : true)),
  ) as Partial<T>;
}
