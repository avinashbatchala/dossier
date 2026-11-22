import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { photoFromFields } from "@/lib/photo";
import { prisma } from "@/lib/prisma";
import { basicsFromFields, factTexts, inEntryOrder, type FactItem, type ProfileData } from "@/lib/profile";
import { loadProfileSettings, profileIdOr } from "@/lib/profiles";

/** The profile's name, "" without one: for the sidebar, the sign-in greeting and file names. */
export async function loadProfileName(): Promise<string> {
  const field = await prisma.profileField.findUnique({ where: { key: "name" } });
  return field?.value ?? "";
}

/** The profile's country as written, for the setup guide's job search step (E22-9). */
export async function loadProfileCountry(): Promise<string> {
  const field = await prisma.profileField.findUnique({ where: { key: "country" } });
  return field?.value ?? "";
}

/**
 * One profile, the first unless another is asked for (E24-1): the shared
 * basics, languages and facts, and that profile's own headline, summary and
 * sections. Experience, projects and education are newest first by start
 * date, or in the order set by hand (E4-9); certifications and publications
 * are always in the order set by hand (#293, #218).
 */
export async function loadProfile(profileId?: string | null, db: PrismaClient | Prisma.TransactionClient = prisma): Promise<ProfileData> {
  const id = await profileIdOr(profileId, db);
  const own = { where: { profileId: id } };
  const [profile, fields, skills, languages, experience, projects, education, certifications, publications, references, customSections, facts, settings] = await Promise.all([
    db.profile.findUniqueOrThrow({ where: { id }, select: { headline: true, summary: true } }),
    db.profileField.findMany(),
    db.skill.findMany({ ...own, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    db.language.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    db.experience.findMany({ ...own, include: { skills: { select: { skillId: true } } } }),
    db.project.findMany({ ...own, include: { skills: { select: { skillId: true } } } }),
    db.education.findMany(own),
    db.certification.findMany({ ...own, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    db.publication.findMany({ ...own, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    db.reference.findMany({ ...own, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    db.customSection.findMany({ ...own, orderBy: { createdAt: "asc" }, include: { items: { orderBy: [{ sort: "asc" }, { createdAt: "asc" }] } } }),
    loadFacts(null, db),
    loadProfileSettings(id, db),
  ]);

  return {
    basics: { ...basicsFromFields(fields), headline: profile.headline, summary: profile.summary },
    photo: photoFromFields(fields),
    skills: skills.map(({ id, name, group }) => ({ id, name, group })),
    languages: languages.map(({ id, name, level }) => ({ id, name, level })),
    experience: inEntryOrder(experience, settings.experienceOrder).map((entry) => ({
      id: entry.id,
      role: entry.role,
      company: entry.company,
      location: entry.location,
      descriptor: entry.descriptor,
      volunteering: entry.volunteering,
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
    certifications: certifications.map(({ id, name, issuer, year, month, expiryYear, expiryMonth, credentialId, link, onResumes }) => ({
      id,
      name,
      issuer,
      year,
      month,
      expiryYear,
      expiryMonth,
      credentialId,
      link,
      onResumes,
    })),
    publications: publications.map(({ id, citation, link, onResumes }) => ({ id, citation, link, onResumes })),
    references: references.map(({ id, name, relation, company, email, phone }) => ({
      id,
      name,
      relation,
      company,
      email,
      phone,
    })),
    customSections: customSections.map(({ id, title, format, countsAs, items }) => ({
      id,
      title,
      format,
      countsAs,
      items: items.map((item) => ({
        id: item.id,
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
      })),
    })),
    facts,
  };
}

/** One application's facts as the AI gets them (APP-15): trimmed, without empty ones. */
export async function loadFactTexts(applicationId: string): Promise<string[]> {
  return factTexts(await loadFacts(applicationId));
}

/** The profile's facts (null), or one application's, in the order they were added. */
export async function loadFacts(applicationId: string | null, db: PrismaClient | Prisma.TransactionClient = prisma): Promise<FactItem[]> {
  return db.fact.findMany({
    where: { applicationId },
    select: { id: true, text: true },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
  });
}
