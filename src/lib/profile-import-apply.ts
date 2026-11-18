import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { citationText } from "@/lib/citation";
import { isOwnBasic, sameName } from "@/lib/profile";
import type { ImportedProfile, ImportMode } from "@/lib/profile-import";
import { loadProfileSettings, saveProfileSettings } from "@/lib/profiles";

type Tx = Prisma.TransactionClient;

/**
 * Applies an imported profile to one profile in one transaction (E4-10,
 * E24-1). Replace clears that profile's own sections, headline and summary
 * first. Merge lets the file win (decided 29 September 2026): its basics
 * overwrite the profile's, and an entry it shares with the profile (the same
 * role and company, project name, degree and school, citation, or reference
 * name) takes what the file says; what the file leaves out is kept.
 * Everything else is added, first in a section ordered by hand, else by date.
 * The shared basics and languages are merged either way: other profiles use
 * them too.
 */
export async function applyImportedProfile(db: PrismaClient, profileId: string, profile: ImportedProfile, mode: ImportMode): Promise<void> {
  const own = { where: { profileId } };
  await db.$transaction(
    async (tx) => {
      if (mode === "replace") {
        await tx.experience.deleteMany(own);
        await tx.project.deleteMany(own);
        await tx.education.deleteMany(own);
        await tx.certification.deleteMany(own);
        await tx.publication.deleteMany(own);
        await tx.reference.deleteMany(own);
        await tx.skill.deleteMany(own);
        await tx.profile.update({ where: { id: profileId }, data: { headline: "", summary: "" } });
        await saveProfileSettings(profileId, { experienceOrder: "date", projectOrder: "date", educationOrder: "date" }, tx);
      }
      const order = await loadProfileSettings(profileId, tx);

      for (const [key, value] of Object.entries(profile.basics)) {
        if (isOwnBasic(key)) await tx.profile.update({ where: { id: profileId }, data: { [key]: value } });
        else await tx.profileField.upsert({ where: { key }, create: { key, value }, update: { value } });
      }

      const skillIds = await applySkills(tx, profileId, profile);
      await applyLanguages(tx, profile);

      const nextExperienceSort = await sorter(tx, profileId, "experience", order.experienceOrder === "manual");
      const roles = await tx.experience.findMany({ ...own, include: { skills: { select: { skillId: true } } } });
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
            data: { ...fields, profileId, sort: nextExperienceSort(), skills: { create: [...new Set(linked)].map((skillId) => ({ skillId })) } },
          });
        }
      }

      const nextProjectSort = await sorter(tx, profileId, "project", order.projectOrder === "manual");
      const known = await tx.project.findMany({ ...own, include: { skills: { select: { skillId: true } } } });
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
            data: { ...fields, profileId, sort: nextProjectSort(), skills: { create: [...new Set(linked)].map((skillId) => ({ skillId })) } },
          });
        }
      }

      const nextEducationSort = await sorter(tx, profileId, "education", order.educationOrder === "manual");
      const degrees = await tx.education.findMany(own);
      for (const fields of profile.education.map(withoutFlags)) {
        const match = degrees.find((degree) => sameName(degree.degree, fields.degree) && sameName(degree.school, fields.school));
        if (match) await tx.education.update({ where: { id: match.id }, data: filled(fields) });
        else await tx.education.create({ data: { ...fields, profileId, sort: nextEducationSort() } });
      }

      // Certifications are in an order set by hand: the file's go after the ones there, in its order (#293).
      const certifications = await tx.certification.findMany(own);
      let certificationSort = ((await tx.certification.aggregate({ ...own, _max: { sort: true } }))._max.sort ?? -1) + 1;
      for (const { year, month, expiryYear, expiryMonth, ...fields } of profile.certifications.map(withoutFlags)) {
        const match = certifications.find((entry) => sameName(entry.name, fields.name));
        // A date the file doesn't give keeps the one that's there.
        const dates = { ...(year === null ? {} : { year, month }), ...(expiryYear === null ? {} : { expiryYear, expiryMonth }) };
        if (match) await tx.certification.update({ where: { id: match.id }, data: { ...filled(fields), ...dates } });
        else await tx.certification.create({ data: { ...fields, ...dates, profileId, sort: certificationSort++ } });
      }

      // Publications are in an order set by hand: the file's go after the ones there, in its order (#218).
      // One that's already there keeps its citation, which may have bold and italics; the file can give it a link.
      const publications = await tx.publication.findMany(own);
      let publicationSort = ((await tx.publication.aggregate({ ...own, _max: { sort: true } }))._max.sort ?? -1) + 1;
      for (const fields of profile.publications.map(withoutFlags)) {
        const match = publications.find((publication) => sameName(citationText(publication.citation), citationText(fields.citation)));
        if (match) await tx.publication.update({ where: { id: match.id }, data: filled({ link: fields.link }) });
        else await tx.publication.create({ data: { ...fields, profileId, sort: publicationSort++ } });
      }

      const references = await tx.reference.findMany(own);
      let referenceSort = ((await tx.reference.aggregate({ ...own, _max: { sort: true } }))._max.sort ?? -1) + 1;
      for (const fields of profile.references.map(withoutFlags)) {
        const match = references.find((reference) => sameName(reference.name, fields.name));
        if (match) await tx.reference.update({ where: { id: match.id }, data: filled(fields) });
        else await tx.reference.create({ data: { ...fields, profileId, sort: referenceSort++ } });
      }
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** Finds or creates each skill in the profile (names ignore case); answers with the ids by lower-case name. */
async function applySkills(tx: Tx, profileId: string, profile: ImportedProfile): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let sort = ((await tx.skill.aggregate({ where: { profileId }, _max: { sort: true } }))._max.sort ?? -1) + 1;
  for (const { name } of profile.skills) {
    const skill = (await tx.skill.findUnique({ where: { profileId_name: { profileId, name } } })) ?? (await tx.skill.create({ data: { profileId, name, sort: sort++ } }));
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
async function sorter(tx: Tx, profileId: string, section: "experience" | "project" | "education", manual: boolean): Promise<() => number> {
  const range = { where: { profileId }, _min: { sort: true }, _max: { sort: true } } as const;
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
