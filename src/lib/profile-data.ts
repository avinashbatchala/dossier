import "server-only";

import { prisma } from "@/lib/prisma";
import { basicsFromFields, inEntryOrder, type ProfileData } from "@/lib/profile";
import { loadSettings } from "@/lib/settings-data";

/** The profile's name, "" without one: for the sidebar, the sign-in greeting and file names. */
export async function loadProfileName(): Promise<string> {
  const field = await prisma.profileField.findUnique({ where: { key: "name" } });
  return field?.value ?? "";
}

/**
 * The whole profile for the editor. Experience, projects and education are
 * newest first by start date, or in the order set by hand (E4-9).
 */
export async function loadProfile(): Promise<ProfileData> {
  const [fields, skills, languages, experience, projects, education, references, settings] = await Promise.all([
    prisma.profileField.findMany(),
    prisma.skill.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    prisma.language.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    prisma.experience.findMany({ include: { skills: { select: { skillId: true } } } }),
    prisma.project.findMany({ include: { skills: { select: { skillId: true } } } }),
    prisma.education.findMany(),
    prisma.reference.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    loadSettings(),
  ]);

  return {
    basics: basicsFromFields(fields),
    skills: skills.map(({ id, name }) => ({ id, name })),
    languages: languages.map(({ id, name, level }) => ({ id, name, level })),
    experience: inEntryOrder(experience, settings.experienceOrder).map((entry) => ({
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
      skillIds: entry.skills.map((link) => link.skillId),
    })),
    projects: inEntryOrder(projects, settings.projectOrder).map((entry) => ({
      id: entry.id,
      name: entry.name,
      link: entry.link,
      bullets: entry.bullets,
      startYear: entry.startYear,
      startMonth: entry.startMonth,
      endYear: entry.endYear,
      endMonth: entry.endMonth,
      current: entry.current,
      skillIds: entry.skills.map((link) => link.skillId),
    })),
    education: inEntryOrder(education, settings.educationOrder).map((entry) => ({
      id: entry.id,
      degree: entry.degree,
      school: entry.school,
      notes: entry.notes,
      startYear: entry.startYear,
      startMonth: entry.startMonth,
      endYear: entry.endYear,
      endMonth: entry.endMonth,
      current: entry.current,
    })),
    references: references.map(({ id, name, relation, company, email, phone }) => ({
      id,
      name,
      relation,
      company,
      email,
      phone,
    })),
  };
}
