import type { LanguageLevel } from "@/generated/prisma/enums";
import type { Unit } from "@/lib/application-data";
import { LANGUAGE_LEVELS, type DateSpan, type ProfileData } from "@/lib/profile";

import sample from "../../prisma/seed/prototype-sample.json";

// The prototype's sample profile (Jane Doe), shared by the demo seed
// (prisma/seed/demo.ts), document previews on /dev/documents and tests.

/** "Mar 2021" → 2021/3, "2013" → 2013/null, "Present" or "" → null. */
function parseMonthYear(text: string): { year: number; month: number | null } | null {
  const match = /^(?:([A-Z][a-z]{2}) )?(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = match[1] ? new Date(`${match[1]} 1, 2000`).getMonth() + 1 : null;
  return { year: Number(match[2]), month };
}

/** A prototype date range ("Mar 2021" to "Present") as structured dates. */
export function dateSpan(start: string, end: string): DateSpan {
  const from = parseMonthYear(start);
  const to = parseMonthYear(end);
  return {
    startYear: from?.year ?? null,
    startMonth: from?.month ?? null,
    endYear: to?.year ?? null,
    endMonth: to?.month ?? null,
    current: end.trim() === "Present",
  };
}

/** Language levels by their label in the prototype, e.g. "Fluent (C2)". */
export const LEVELS_BY_LABEL = new Map<string, LanguageLevel>(
  LANGUAGE_LEVELS.map(({ value, label }) => [label, value]),
);

/** The sample profile as `loadProfile()` returns it, with the prototype's ids. */
export function demoProfile(): ProfileData {
  const { experience, projects, education, skills, languages, references, showAge, ...basics } = sample.profile;
  const skillId = (name: string) => `skill-${skills.indexOf(name) + 1}`;
  return {
    basics: {
      name: basics.name,
      headline: basics.headline,
      email: basics.email,
      phone: basics.phone,
      dob: basics.dob,
      website: basics.website,
      address: basics.address,
      city: basics.city,
      country: basics.country,
      linkedin: basics.linkedin,
      summary: basics.summary,
      showAge,
    },
    skills: skills.map((name) => ({ id: skillId(name), name })),
    languages: languages.map(({ name, level }, index) => ({
      id: `language-${index + 1}`,
      name,
      level: LEVELS_BY_LABEL.get(level)!,
    })),
    experience: experience.map((entry) => ({
      id: entry.id,
      role: entry.role,
      company: entry.company,
      location: entry.location,
      bullets: entry.bullets,
      ...dateSpan(entry.start, entry.end),
      skillIds: entry.skills.map(skillId),
    })),
    projects: projects.map((entry) => ({
      id: entry.id,
      name: entry.name,
      link: entry.link,
      bullets: entry.bullets,
      ...dateSpan(entry.start, entry.end),
      skillIds: entry.skills.map(skillId),
    })),
    education: education.map((entry) => ({
      id: entry.id,
      degree: entry.degree,
      school: entry.school,
      notes: entry.notes,
      ...dateSpan(entry.start, entry.end),
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

/**
 * The prototype's tailored resume for Ledgerly, as units in reading order.
 * Pass how to turn the sample's entry ids ("e1", "d1", "p1") into real ones.
 */
export function demoResumeUnits(
  experienceId: (sampleId: string) => string = (id) => id,
  educationId: (sampleId: string) => string = (id) => id,
  projectId: (sampleId: string) => string = (id) => id,
): Unit[] {
  const { experience, projects, education, skills, languages } = sample.profile;
  const { resume, requirements } = sample.ledgerly;
  // Skills the posting asks for come first.
  const asked = requirements.flatMap((requirement) =>
    "skill" in requirement && requirement.skill && skills.includes(requirement.skill) ? [requirement.skill] : [],
  );
  return [
    { id: "summary", label: "Summary", text: resume.summary },
    ...experience.map((entry) => ({
      id: `experience:${experienceId(entry.id)}`,
      label: `${entry.company} role`,
      text: resume.experience[entry.id as keyof typeof resume.experience],
    })),
    ...projects.map((entry) => ({ id: `project:${projectId(entry.id)}`, label: `${entry.name} project`, text: entry.bullets })),
    { id: "skills", label: "Skills", text: [...asked, ...skills.filter((skill) => !asked.includes(skill))].join(" · ") },
    ...education.map((entry) => ({
      id: `education:${educationId(entry.id)}`,
      label: entry.degree,
      text: entry.notes,
    })),
    {
      id: "languages",
      label: "Languages",
      text: languages.map((language) => `${language.name}: ${language.level}`).join(" · "),
    },
  ];
}

/** The prototype's cover letter for Ledgerly, one unit per paragraph. */
export function demoLetterUnits(): Unit[] {
  return sample.ledgerly.letter.map((paragraph, index) => ({ id: `paragraph:${index + 1}`, ...paragraph }));
}

/** The prototype's Ledgerly job posting, offered as a sample before the first application (E7-1). */
export const DEMO_POSTING: string = sample.ledgerly.posting;
