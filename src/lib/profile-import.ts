import { z } from "zod";

import { LanguageLevel } from "@/generated/prisma/enums";
import { BASICS_FIELDS, type BasicsField } from "@/lib/profile";
import { levelRangeSchema } from "@/lib/profile-levels";

// A profile read from a resume file (E4-10, PRO-12), as the preview shows it
// and the import applies it. Anything the file's text doesn't contain is
// marked, so the preview can say "check this".

const span = {
  startYear: z.number().int().nullable(),
  startMonth: z.number().int().min(1).max(12).nullable(),
  endYear: z.number().int().nullable(),
  endMonth: z.number().int().min(1).max(12).nullable(),
  current: z.boolean(),
};
/** Words of an entry that aren't in the file, e.g. a company the model misspelled. */
const unverified = z.array(z.string());

/** The Basics fields as the import's review names them. */
export const BASICS_LABELS: Record<BasicsField, string> = {
  name: "Full name",
  headline: "Headline",
  email: "Email",
  phone: "Phone",
  dob: "Date of birth",
  website: "Website",
  address: "Street address",
  city: "City",
  country: "Country",
  linkedin: "LinkedIn",
  summary: "About you",
};

export const importedProfileSchema = z.object({
  basics: z.partialRecord(z.enum(BASICS_FIELDS), z.string()),
  skills: z.array(z.object({ name: z.string(), found: z.boolean() })),
  languages: z.array(z.object({ name: z.string(), level: z.enum(LanguageLevel), levelGiven: z.boolean() })),
  experience: z.array(
    // descriptor: absent in readings from before #257; volunteering: from before #294.
    z.object({
      role: z.string(),
      company: z.string(),
      location: z.string(),
      descriptor: z.string().default(""),
      volunteering: z.boolean().default(false),
      bullets: z.string(),
      skills: z.array(z.string()),
      ...span,
      unverified,
    }),
  ),
  /** Absent in readings made before projects (PRO-13). */
  projects: z
    .array(z.object({ name: z.string(), link: z.string(), bullets: z.string(), skills: z.array(z.string()), ...span, unverified }))
    .default([]),
  education: z.array(z.object({ degree: z.string(), school: z.string(), notes: z.string(), ...span, unverified })),
  /** Absent in readings made before certifications (#293). */
  certifications: z
    .array(
      z.object({
        name: z.string(),
        issuer: z.string(),
        year: z.number().nullable(),
        month: z.number().nullable(),
        expiryYear: z.number().nullable(),
        expiryMonth: z.number().nullable(),
        credentialId: z.string(),
        link: z.string(),
        unverified,
      }),
    )
    .default([]),
  /** Absent in readings made before publications (#218). */
  publications: z.array(z.object({ citation: z.string(), link: z.string(), unverified })).default([]),
  references: z.array(
    z.object({ name: z.string(), relation: z.string(), company: z.string(), email: z.string(), phone: z.string(), unverified }),
  ),
  /** What the model gave that wasn't kept, and why (#371): "Country “Oregon”: not a country". Absent in older readings. */
  leftOut: z.array(z.string()).default([]),
  /** The levels it points to (E24-3), for a profile without them; absent in readings made before. */
  levels: levelRangeSchema.nullable().default(null),
});
export type ImportedProfile = z.infer<typeof importedProfileSchema>;

/** Merge into the profile (what the file says wins) or replace it (decided 29 September 2026). */
export type ImportMode = "merge" | "replace";

/** The steps of reading a resume, as the progress shows them. */
export const IMPORT_PROFILE_STEPS = ["Reading your resume", "Sorting it into your profile"] as const;

/** "3 roles, 1 project, 12 skills…": what a preview holds, for the page and the toast. */
export function importCounts(profile: ImportedProfile): string {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [
    plural(profile.experience.length, "role", "roles"),
    plural(profile.projects.length, "project", "projects"),
    plural(profile.education.length, "degree", "degrees"),
    // Optional and rare: only said when there are some (#293, #218).
    ...(profile.certifications.length > 0 ? [plural(profile.certifications.length, "certification", "certifications")] : []),
    ...(profile.publications.length > 0 ? [plural(profile.publications.length, "publication", "publications")] : []),
    plural(profile.skills.length, "skill", "skills"),
    plural(profile.languages.length, "language", "languages"),
    plural(profile.references.length, "reference", "references"),
  ].join(", ");
}
