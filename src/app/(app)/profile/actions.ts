"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { JobStatus, LanguageLevel } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { fieldsFromBasics, inEntryOrder } from "@/lib/profile";
import { findOrCreateSkill, firstSort, nextSort } from "@/lib/profile-entries";
import { discardProfileImports, importProfileJob } from "@/lib/jobs/import-profile";
import { loadProfileName } from "@/lib/profile-data";
import { importCounts } from "@/lib/profile-import";
import { applyImportedProfile } from "@/lib/profile-import-apply";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Every profile change saves through these actions; they all check the
// session (action()) and validate their input.

const text = (max: number) => z.string().max(max);

/** Saves the Basics section (PRO-1, PRO-2); autosaved as you type. */
export const saveBasics = action(
  z.object({
    name: text(200),
    headline: text(300),
    email: text(320),
    phone: text(60),
    dob: z.union([z.literal(""), z.iso.date()]),
    website: text(500),
    address: text(300),
    city: text(120),
    country: text(120),
    linkedin: text(500),
    summary: text(5000),
    showAge: z.boolean(),
  }),
  async (basics) => {
    const before = await loadProfileName();
    await prisma.$transaction(
      Object.entries(fieldsFromBasics(basics)).map(([key, value]) =>
        value === null
          ? prisma.profileField.deleteMany({ where: { key } })
          : prisma.profileField.upsert({ where: { key }, create: { key, value }, update: { value } }),
      ),
    );
    // The sidebar shows the name.
    if (before !== basics.name) revalidatePath("/", "layout");
    return null;
  },
);

const id = z.string().min(1);
const skillName = z.string().trim().min(1, "Type a skill first.").max(100);

/** Adds a skill (PRO-3). An existing one, in any case, is returned instead of a duplicate. */
export const addSkill = action(z.object({ name: skillName }), ({ name }) => findOrCreateSkill(name));

/** Removes a skill; the database also detaches it from every role (PRO-3). */
export const removeSkill = action(z.object({ id }), async ({ id }) => {
  await prisma.skill.deleteMany({ where: { id } });
  return null;
});

const level = z.enum(LanguageLevel);

/**
 * Adds a language with its level (PRO-4). Adding one that exists, in any
 * case, updates its level instead of adding a duplicate.
 */
export const addLanguage = action(
  z.object({ name: z.string().trim().min(1, "Type a language first.").max(100), level }),
  async ({ name, level }) => {
    const existing = await prisma.language.findUnique({ where: { name } });
    const language = existing
      ? await prisma.language.update({ where: { id: existing.id }, data: { level } })
      : await prisma.language.create({ data: { name, level, sort: await nextSort(prisma.language) } });
    return { language: { id: language.id, name: language.name, level: language.level }, added: !existing };
  },
);

export const setLanguageLevel = action(z.object({ id, level }), async ({ id, level }) => {
  await prisma.language.updateMany({ where: { id }, data: { level } });
  return null;
});

export const removeLanguage = action(z.object({ id }), async ({ id }) => {
  await prisma.language.deleteMany({ where: { id } });
  return null;
});

// ─── Experience (PRO-5, PRO-6) ───────────────────────────────────────────────

const year = z.number().int().min(1900).max(2100).nullable();
const month = z.number().int().min(1).max(12).nullable();
const dateSpan = { startYear: year, startMonth: month, endYear: year, endMonth: month, current: z.boolean() };

const experienceFields = z.object({
  id,
  role: text(200),
  company: text(200),
  location: text(200),
  bullets: text(10_000),
  ...dateSpan,
});

const experienceItem = (entry: {
  id: string;
  role: string;
  company: string;
  location: string;
  bullets: string;
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  current: boolean;
}, skillIds: string[] = []) => ({
  id: entry.id,
  role: entry.role,
  company: entry.company,
  location: entry.location,
  bullets: entry.bullets,
  startYear: entry.startYear,
  startMonth: entry.startMonth,
  endYear: entry.endYear,
  endMonth: entry.endMonth,
  current: entry.current,
  skillIds,
});

/** "+ Add a role": a blank entry, last in date order (it has no dates yet), first in an order set by hand. */
export const createExperience = action(z.object({}), async () => {
  const manual = (await loadSettings()).experienceOrder === "manual";
  const sort = manual ? await firstSort(prisma.experience) : await nextSort(prisma.experience);
  return experienceItem(await prisma.experience.create({ data: { sort } }));
});

/** Autosaves a role. Saving one that was just removed does nothing. */
export const saveExperience = action(experienceFields, async ({ id, ...data }) => {
  await prisma.experience.updateMany({ where: { id }, data });
  return null;
});

/** Removes a role and its skill links; the toast's Undo calls restoreExperience. */
export const removeExperience = action(z.object({ id }), async ({ id }) => {
  await prisma.experience.deleteMany({ where: { id } });
  return null;
});

/** Puts a removed role back, with the links to skills that still exist. */
export const restoreExperience = action(
  experienceFields.extend({ skillIds: z.array(id) }),
  async ({ skillIds, ...entry }) => {
    const skills = await prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true } });
    const restored = await prisma.experience.upsert({
      where: { id: entry.id },
      create: {
        ...entry,
        sort: await nextSort(prisma.experience),
        skills: { create: skills.map((skill) => ({ skillId: skill.id })) },
      },
      update: {},
    });
    return experienceItem(restored, skills.map((skill) => skill.id));
  },
);

/** Attaches a skill to a role, or detaches it (PRO-6). */
export const setExperienceSkill = action(
  z.object({ experienceId: id, skillId: id, attached: z.boolean() }),
  async ({ experienceId, skillId, attached }) => {
    if (attached) {
      await prisma.experienceSkill.createMany({ data: [{ experienceId, skillId }], skipDuplicates: true });
    } else {
      await prisma.experienceSkill.deleteMany({ where: { experienceId, skillId } });
    }
    return null;
  },
);

/** "New skill? Type it and press Enter": adds it to the profile if it's new and attaches it (PRO-6). */
export const attachNewSkill = action(
  z.object({ experienceId: id, name: skillName }),
  async ({ experienceId, name }) => {
    const result = await findOrCreateSkill(name);
    await prisma.experienceSkill.createMany({
      data: [{ experienceId, skillId: result.skill.id }],
      skipDuplicates: true,
    });
    return result;
  },
);

// ─── Projects (PRO-13) ───────────────────────────────────────────────────────

const projectFields = z.object({
  id,
  name: text(200),
  link: text(500),
  bullets: text(10_000),
  ...dateSpan,
});

const projectItem = (entry: z.infer<typeof projectFields>, skillIds: string[] = []) => ({
  id: entry.id,
  name: entry.name,
  link: entry.link,
  bullets: entry.bullets,
  startYear: entry.startYear,
  startMonth: entry.startMonth,
  endYear: entry.endYear,
  endMonth: entry.endMonth,
  current: entry.current,
  skillIds,
});

/** "+ Add a project": a blank entry, placed like a new role. */
export const createProject = action(z.object({}), async () => {
  const manual = (await loadSettings()).projectOrder === "manual";
  const sort = manual ? await firstSort(prisma.project) : await nextSort(prisma.project);
  return projectItem(await prisma.project.create({ data: { sort } }));
});

/** Autosaves a project. Saving one that was just removed does nothing. */
export const saveProject = action(projectFields, async ({ id, ...data }) => {
  await prisma.project.updateMany({ where: { id }, data });
  return null;
});

/** Removes a project and its skill links; the toast's Undo calls restoreProject. */
export const removeProject = action(z.object({ id }), async ({ id }) => {
  await prisma.project.deleteMany({ where: { id } });
  return null;
});

/** Puts a removed project back, with the links to skills that still exist. */
export const restoreProject = action(projectFields.extend({ skillIds: z.array(id) }), async ({ skillIds, ...entry }) => {
  const skills = await prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true } });
  const restored = await prisma.project.upsert({
    where: { id: entry.id },
    create: {
      ...entry,
      sort: await nextSort(prisma.project),
      skills: { create: skills.map((skill) => ({ skillId: skill.id })) },
    },
    update: {},
  });
  return projectItem(restored, skills.map((skill) => skill.id));
});

/** Attaches a skill to a project, or detaches it. */
export const setProjectSkill = action(
  z.object({ projectId: id, skillId: id, attached: z.boolean() }),
  async ({ projectId, skillId, attached }) => {
    if (attached) {
      await prisma.projectSkill.createMany({ data: [{ projectId, skillId }], skipDuplicates: true });
    } else {
      await prisma.projectSkill.deleteMany({ where: { projectId, skillId } });
    }
    return null;
  },
);

/** "New skill? Type it and press Enter" on a project: adds it to the profile if it's new and attaches it. */
export const attachNewProjectSkill = action(z.object({ projectId: id, name: skillName }), async ({ projectId, name }) => {
  const result = await findOrCreateSkill(name);
  await prisma.projectSkill.createMany({ data: [{ projectId, skillId: result.skill.id }], skipDuplicates: true });
  return result;
});

// ─── Education (PRO-7) ───────────────────────────────────────────────────────

const educationFields = z.object({
  id,
  degree: text(200),
  school: text(200),
  notes: text(5000),
  ...dateSpan,
});

const educationItem = (entry: z.infer<typeof educationFields>) => ({
  id: entry.id,
  degree: entry.degree,
  school: entry.school,
  notes: entry.notes,
  startYear: entry.startYear,
  startMonth: entry.startMonth,
  endYear: entry.endYear,
  endMonth: entry.endMonth,
  current: entry.current,
});

export const createEducation = action(z.object({}), async () => {
  const manual = (await loadSettings()).educationOrder === "manual";
  const sort = manual ? await firstSort(prisma.education) : await nextSort(prisma.education);
  return educationItem(await prisma.education.create({ data: { sort } }));
});

export const saveEducation = action(educationFields, async ({ id, ...data }) => {
  await prisma.education.updateMany({ where: { id }, data });
  return null;
});

export const removeEducation = action(z.object({ id }), async ({ id }) => {
  await prisma.education.deleteMany({ where: { id } });
  return null;
});

export const restoreEducation = action(educationFields, async (entry) =>
  educationItem(
    await prisma.education.upsert({
      where: { id: entry.id },
      create: { ...entry, sort: await nextSort(prisma.education) },
      update: {},
    }),
  ),
);

// ─── Order (E4-9) ────────────────────────────────────────────────────────────

const section = z.enum(["experience", "project", "education"]);
type Section = z.infer<typeof section>;

/** Each ordered section's setting. */
const ORDER_SETTING = { experience: "experienceOrder", project: "projectOrder", education: "educationOrder" } as const;

/** The section's table, as far as ordering needs it. */
function entries(db: Prisma.TransactionClient, section: Section) {
  const select = { id: true, sort: true, startYear: true, startMonth: true, endYear: true, endMonth: true, current: true } as const;
  const setSort = (entryId: string, sort: number) => ({ where: { id: entryId }, data: { sort } });
  if (section === "experience") {
    return { list: () => db.experience.findMany({ select }), setSort: (entryId: string, sort: number) => db.experience.update(setSort(entryId, sort)) };
  }
  if (section === "project") {
    return { list: () => db.project.findMany({ select }), setSort: (entryId: string, sort: number) => db.project.update(setSort(entryId, sort)) };
  }
  return { list: () => db.education.findMany({ select }), setSort: (entryId: string, sort: number) => db.education.update(setSort(entryId, sort)) };
}

/**
 * Saves an order set by hand: `ids` is every entry of the section, in the new
 * order. From then on the section keeps that order instead of dates.
 */
export const reorderEntries = action(z.object({ section, ids: z.array(id) }), async ({ section, ids }) => {
  await prisma.$transaction(async (tx) => {
    const table = entries(tx, section);
    const known = new Set((await table.list()).map((entry) => entry.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((entryId) => known.has(entryId))) {
      throw new ActionError("The list changed in the meantime. Reload the page and try again.");
    }
    for (const [sort, entryId] of ids.entries()) await table.setSort(entryId, sort);
    await saveSettings({ [ORDER_SETTING[section]]: "manual" }, tx);
  });
  return null;
});

/** Goes back to date order; returns the section's ids in that order for the list. */
export const sortEntriesByDate = action(z.object({ section }), async ({ section }) => {
  await saveSettings({ [ORDER_SETTING[section]]: "date" });
  return inEntryOrder(await entries(prisma, section).list(), "date").map((entry) => entry.id);
});

// ─── Import from a resume (E4-10) ───────────────────────────────────────────

/**
 * Merges the profile read from a resume into the profile, or replaces it.
 * Nothing goes into the profile before this: the read profile waits in its
 * job, and is taken from there rather than from the browser. Then the job is
 * deleted, with the resume's text.
 */
export const applyProfileImport = action(
  z.object({ jobId: id, mode: z.enum(["merge", "replace"]) }),
  async ({ jobId, mode }, { toast }) => {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { type: true, status: true, result: true } });
    if (job?.type !== importProfileJob.type || job.status !== JobStatus.DONE) {
      throw new ActionError("That resume isn't read yet, or it's no longer there. Choose the file again.");
    }
    const { profile } = importProfileJob.result.parse(job.result);
    await applyImportedProfile(prisma, profile, mode);
    await prisma.job.deleteMany({ where: { id: jobId } });
    revalidatePath("/", "layout");
    toast(`${mode === "replace" ? "Your profile now holds" : "Added to your profile"}: ${importCounts(profile)}.`);
    return null;
  },
);

/** "Choose another file": the reading is deleted, with the resume's text, and stopped if it's under way. */
export const discardProfileImport = action(z.object({ jobId: id }), async ({ jobId }) => {
  await discardProfileImports(jobId);
  return null;
});

// ─── References (PRO-8) ──────────────────────────────────────────────────────

const referenceFields = z.object({
  id,
  name: text(200),
  relation: text(200),
  company: text(200),
  email: text(320),
  phone: text(60),
});

const referenceItem = (entry: z.infer<typeof referenceFields>) => ({
  id: entry.id,
  name: entry.name,
  relation: entry.relation,
  company: entry.company,
  email: entry.email,
  phone: entry.phone,
});

export const createReference = action(z.object({}), async () =>
  referenceItem(await prisma.reference.create({ data: { sort: await nextSort(prisma.reference) } })),
);

export const saveReference = action(referenceFields, async ({ id, ...data }) => {
  await prisma.reference.updateMany({ where: { id }, data });
  return null;
});

export const removeReference = action(z.object({ id }), async ({ id }) => {
  await prisma.reference.deleteMany({ where: { id } });
  return null;
});

export const restoreReference = action(referenceFields, async (entry) =>
  referenceItem(
    await prisma.reference.upsert({
      where: { id: entry.id },
      create: { ...entry, sort: await nextSort(prisma.reference) },
      update: {},
    }),
  ),
);
