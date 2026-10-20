import type { Unit } from "@/lib/application-data";
import { ageLabel, ENGLISH_LABELS, languagesLine, type DocumentLabels } from "@/lib/document-labels";
import { ageOn, formatDateRange, type Basics, type ProfileData } from "@/lib/profile";

// What a resume shows, worked out from the profile (the base resume) or from
// a tailored document's units, so the renderer only has to lay it out.

export type ResumeContent = {
  name: string;
  headline: string;
  /** Email, phone, "City, Country", website, LinkedIn and "Age N", whichever are filled in. */
  contacts: string[];
  summary: string;
  experience: {
    id: string;
    role: string;
    company: string;
    dates: string;
    bullets: string[];
    /** The skills used in the role (RES-6). */
    skills: string[];
  }[];
  /** Projects (PRO-13), laid out like roles. */
  projects: {
    id: string;
    name: string;
    /** "github.com/jane/tidewater", without "https://". */
    link: string;
    dates: string;
    bullets: string[];
    skills: string[];
  }[];
  education: { id: string; degree: string; school: string; dates: string; notes: string }[];
  /** "Figma · User research · …" */
  skills: string;
  /** "Dutch: Native · English: Fluent (C2)" */
  languages: string;
  references: { id: string; name: string; role: string; contact: string }[];
};

export type ResumeOptions = {
  /** A tailored document's units; they replace the profile's text (APP-4). */
  units?: Unit[];
  /** Settings → "Include references" (SET-9). */
  includeReferences?: boolean;
  /** For "Age N"; defaults to now. */
  today?: Date;
};

/** The separator between contact details on one line. */
export const CONTACT_SEPARATOR = "  ·  ";

/** Contact details in the order the resume header lists them. */
export function contactItems(basics: Basics, today = new Date(), labels = ENGLISH_LABELS): string[] {
  const age = basics.showAge ? ageOn(basics.dob, today) : null;
  return [
    basics.email,
    basics.phone,
    [basics.city, basics.country].map((part) => part.trim()).filter(Boolean).join(", "),
    basics.website,
    basics.linkedin,
    age === null ? "" : ageLabel(age, labels),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
}

/** A link as a resume shows it: "https://www.example.com/x/" is "example.com/x". */
export const displayLink = (link: string) =>
  link
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** What the resume shows, with its dates and levels in the words of `labels`. */
export function resumeContent(
  profile: ProfileData,
  { units, includeReferences = false, today = new Date() }: ResumeOptions = {},
  labels: DocumentLabels = ENGLISH_LABELS,
): ResumeContent {
  const { basics } = profile;
  const skillNames = new Map(profile.skills.map((skill) => [skill.id, skill.name]));
  const dates = { locale: labels.locale, present: labels.present };

  const experience = (entry: ProfileData["experience"][number], bullets: string) => ({
    id: entry.id,
    role: entry.role.trim(),
    company: entry.company.trim(),
    dates: formatDateRange(entry, dates),
    bullets: lines(bullets),
    skills: entry.skillIds.flatMap((id) => skillNames.get(id) ?? []),
  });
  const project = (entry: ProfileData["projects"][number], bullets: string) => ({
    id: entry.id,
    name: entry.name.trim(),
    link: displayLink(entry.link),
    dates: formatDateRange(entry, dates),
    bullets: lines(bullets),
    skills: entry.skillIds.flatMap((id) => skillNames.get(id) ?? []),
  });
  const education = (entry: ProfileData["education"][number], notes: string) => ({
    id: entry.id,
    degree: entry.degree.trim(),
    school: entry.school.trim(),
    dates: formatDateRange(entry, dates),
    notes: notes.trim(),
  });

  const content: ResumeContent = {
    name: basics.name.trim() || "Your name",
    headline: basics.headline.trim(),
    contacts: contactItems(basics, today, labels),
    summary: basics.summary.trim(),
    experience: profile.experience.map((entry) => experience(entry, entry.bullets)),
    projects: profile.projects.map((entry) => project(entry, entry.bullets)),
    education: profile.education.map((entry) => education(entry, entry.notes)),
    skills: profile.skills.map((skill) => skill.name).join(" · "),
    languages: languagesLine(profile.languages, labels),
    references: includeReferences
      ? profile.references.map((reference) => ({
          id: reference.id,
          name: reference.name.trim(),
          role: [reference.relation, reference.company].map((part) => part.trim()).filter(Boolean).join(", "),
          contact: [reference.email, reference.phone].map((part) => part.trim()).filter(Boolean).join(" · "),
        }))
      : [],
  };

  if (units) {
    // A tailored resume holds exactly what its units hold, in their order:
    // a role, project or degree without a unit was left out on purpose.
    const text = (id: string) => units.find((unit) => unit.id === id)?.text ?? "";
    const withUnit = <T extends { id: string }>(prefix: string, entries: T[]) =>
      units.flatMap((unit) => {
        if (!unit.id.startsWith(prefix)) return [];
        const entry = entries.find(({ id }) => `${prefix}${id}` === unit.id);
        return entry ? [{ entry, text: unit.text }] : [];
      });

    content.summary = text("summary").trim();
    content.skills = text("skills").trim();
    content.languages = text("languages").trim();
    content.experience = withUnit("experience:", profile.experience).map(({ entry, text }) =>
      experience(entry, text),
    );
    content.projects = withUnit("project:", profile.projects).map(({ entry, text }) => project(entry, text));
    content.education = withUnit("education:", profile.education).map(({ entry, text }) =>
      education(entry, text),
    );
  }

  return content;
}
