import type { CustomSectionFormat } from "@/generated/prisma/enums";
import type { Unit } from "@/lib/application-data";
import { ageLabel, ENGLISH_LABELS, languagesLine, type DocumentLabels } from "@/lib/document-labels";
import { keepBold, publicationHref, publicationLink } from "@/lib/citation";
import { ageOn, formatDateRange, formatMonthYear, paidRoles, resumeCertifications, resumeCustomSections, resumePublications, type Basics, type CustomItem, type ProfileData } from "@/lib/profile";
import { BUILT_IN_SECTIONS, customKey, type BuiltInSection } from "@/lib/resume-sections";
import { inEditorOrder, skillsText } from "@/lib/skill-groups";
import { webHref } from "@/lib/web-link";

// What a resume shows, worked out from the profile (the base resume) or from
// a tailored document's units, so the renderer only has to lay it out.

export type ResumeContent = {
  name: string;
  headline: string;
  /** The profile photo's data URL, or null when the resume has none (#224). */
  photo: string | null;
  /** Email, phone, "City, Country", website, LinkedIn and "Age N", whichever are filled in. */
  contacts: string[];
  summary: string;
  /** The paid roles. */
  experience: ResumeRole[];
  /** Volunteering (#294), laid out like roles under its own heading. */
  volunteering: ResumeRole[];
  /** Projects (PRO-13), laid out like roles. */
  projects: {
    id: string;
    name: string;
    /** "github.com/jane/tidewater", without "https://". */
    link: string;
    /** What the link opens, or null when it isn't a web address (#369). */
    href: string | null;
    dates: string;
    bullets: string[];
    skills: string[];
  }[];
  education: { id: string; degree: string; school: string; dates: string; notes: string }[];
  /** Certifications (#293), as written, in the profile's order. */
  certifications: {
    id: string;
    name: string;
    issuer: string;
    /** When it was obtained: "Mar 2024". */
    date: string;
    /** "Valid until Mar 2027" and "Credential ID IDI-20481", whichever it has. */
    details: string[];
    /** "verify.example.org/IDI-20481", without "https://". */
    link: string;
    /** What the link opens, or null when it isn't a web address. */
    href: string | null;
  }[];
  /** Publications (#218), word for word, in the profile's order. */
  publications: {
    id: string;
    /** As written, with **bold** and *italic*. */
    citation: string;
    /** "doi.org/10.1038/…", without "https://". */
    link: string;
    /** What the link opens, or null when it isn't a web address. */
    href: string | null;
  }[];
  /** Sections the user made (#298), word for word, in their format. */
  customSections: {
    id: string;
    title: string;
    format: CustomSectionFormat;
    items: {
      id: string;
      /** An entry's title or the line itself, with **bold** and *italic* in a line. */
      title: string;
      subtitle: string;
      dates: string;
      bullets: string[];
      /** "example.org/award", without "https://". */
      link: string;
      /** What the link opens, or null when it isn't a web address. */
      href: string | null;
    }[];
  }[];
  /** "Figma · User research · …" */
  skills: string;
  /** "Dutch: Native · English: Fluent (C2)" */
  languages: string;
  references: { id: string; name: string; role: string; contact: string }[];
};

export type ResumeRole = {
  id: string;
  role: string;
  company: string;
  /** A line about the company or the role (#257), as written; never tailored. */
  descriptor: string;
  dates: string;
  bullets: string[];
  /** The skills used in the role (RES-6). */
  skills: string[];
};

export type ResumeOptions = {
  /** A tailored document's units; they replace the profile's text (APP-4). */
  units?: Unit[];
  /** Settings → "Include references" (SET-9). */
  includeReferences?: boolean;
  /** An application's Photo switch (#224); null or left out follows the profile's "Show on resumes". */
  showPhoto?: boolean | null;
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
    displayLink(basics.website),
    displayLink(basics.linkedin),
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

/** The sections that have something to show, whatever their order. */
export function sectionsWithContent(content: ResumeContent): string[] {
  const filled: Record<BuiltInSection, boolean> = {
    summary: content.summary !== "",
    experience: content.experience.length > 0,
    volunteering: content.volunteering.length > 0,
    projects: content.projects.length > 0,
    education: content.education.length > 0,
    certifications: content.certifications.length > 0,
    publications: content.publications.length > 0,
    references: content.references.length > 0,
    skills: content.skills !== "",
    languages: content.languages !== "",
  };
  return [...BUILT_IN_SECTIONS.filter((key) => filled[key]), ...content.customSections.map((section) => customKey(section.id))];
}

/** What the resume shows, with its dates and levels in the words of `labels`. */
export function resumeContent(
  profile: ProfileData,
  { units, includeReferences = false, showPhoto, today = new Date() }: ResumeOptions = {},
  labels: DocumentLabels = ENGLISH_LABELS,
): ResumeContent {
  const { basics } = profile;
  const skillNames = new Map(profile.skills.map((skill) => [skill.id, skill.name]));
  const dates = { locale: labels.locale, present: labels.present };

  const experience = (entry: ProfileData["experience"][number], bullets: string) => ({
    id: entry.id,
    role: entry.role.trim(),
    company: entry.company.trim(),
    descriptor: entry.descriptor.trim(),
    dates: formatDateRange(entry, dates),
    // A tailored text gets the profile's bold back where it keeps the words (#368).
    bullets: lines(keepBold(bullets, entry.bullets)),
    skills: entry.skillIds.flatMap((id) => skillNames.get(id) ?? []),
  });
  const project = (entry: ProfileData["projects"][number], bullets: string) => ({
    id: entry.id,
    name: entry.name.trim(),
    link: displayLink(entry.link),
    href: webHref(entry.link),
    dates: formatDateRange(entry, dates),
    bullets: lines(keepBold(bullets, entry.bullets)),
    skills: entry.skillIds.flatMap((id) => skillNames.get(id) ?? []),
  });
  const publication = (entry: ProfileData["publications"][number], citation: string) => ({
    id: entry.id,
    citation: citation.trim(),
    link: displayLink(publicationLink(entry.link)),
    href: publicationHref(entry.link),
  });
  const certification = (entry: ProfileData["certifications"][number], name: string) => ({
    id: entry.id,
    name: name.trim(),
    issuer: entry.issuer.trim(),
    date: formatMonthYear(entry.year, entry.month, dates),
    details: [
      entry.expiryYear === null ? "" : labels.validUntil(formatMonthYear(entry.expiryYear, entry.expiryMonth, dates)),
      entry.credentialId.trim() && `${labels.credentialId} ${entry.credentialId.trim()}`,
    ].filter(Boolean),
    link: displayLink(entry.link),
    href: webHref(entry.link),
  });
  const education = (entry: ProfileData["education"][number], notes: string) => ({
    id: entry.id,
    degree: entry.degree.trim(),
    school: entry.school.trim(),
    dates: formatDateRange(entry, dates),
    notes: notes.trim(),
  });

  const customItem = (item: CustomItem, title: string, details: string) => ({
    id: item.id,
    title: title.trim(),
    subtitle: item.subtitle.trim(),
    dates: formatDateRange(item, dates),
    bullets: lines(details),
    link: displayLink(item.link),
    href: webHref(item.link),
  });

  const content: ResumeContent = {
    name: basics.name.trim() || "Your name",
    headline: basics.headline.trim(),
    photo: profile.photo && (showPhoto ?? profile.photo.onResumes) ? profile.photo.src : null,
    contacts: contactItems(basics, today, labels),
    summary: basics.summary.trim(),
    experience: paidRoles(profile.experience).map((entry) => experience(entry, entry.bullets)),
    volunteering: profile.experience.filter((entry) => entry.volunteering).map((entry) => experience(entry, entry.bullets)),
    projects: profile.projects.map((entry) => project(entry, entry.bullets)),
    education: profile.education.map((entry) => education(entry, entry.notes)),
    certifications: resumeCertifications(profile.certifications).map((entry) => certification(entry, entry.name)),
    publications: resumePublications(profile.publications).map((entry) => publication(entry, entry.citation)),
    customSections: resumeCustomSections(profile.customSections).map((section) => ({
      id: section.id,
      title: section.title.trim(),
      format: section.format,
      items: section.items.map((item) => customItem(item, item.title, item.details)),
    })),
    // A line per group, as Profile → Skills shows them (#280).
    skills: skillsText(inEditorOrder(profile.skills)),
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
    // a role, project, degree, certification, publication or custom item without a unit was left out on purpose.
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
    content.experience = withUnit("experience:", paidRoles(profile.experience)).map(({ entry, text }) => experience(entry, text));
    content.volunteering = withUnit(
      "experience:",
      profile.experience.filter((entry) => entry.volunteering),
    ).map(({ entry, text }) => experience(entry, text));
    content.projects = withUnit("project:", profile.projects).map(({ entry, text }) => project(entry, text));
    content.education = withUnit("education:", profile.education).map(({ entry, text }) =>
      education(entry, text),
    );
    content.certifications = withUnit("certification:", profile.certifications).flatMap(({ entry, text }) =>
      text.trim() ? [certification(entry, text)] : [],
    );
    content.publications = withUnit("publication:", profile.publications).flatMap(({ entry, text }) =>
      text.trim() ? [publication(entry, text)] : [],
    );
    content.customSections = profile.customSections.flatMap((section) => {
      const items =
        section.format === "ENTRIES"
          ? withUnit("custom-entry:", section.items).map(({ entry, text }) => customItem(entry, entry.title, text))
          : section.format === "LINES"
            ? withUnit("custom-line:", section.items).flatMap(({ entry, text }) => (text.trim() ? [customItem(entry, text, "")] : []))
            : // An inline section is one part, an item per line.
              lines(text(`custom-inline:${section.id}`)).map((line, index) => ({ id: String(index), title: line, subtitle: "", dates: "", bullets: [], link: "", href: null }));
      return items.length > 0 ? [{ id: section.id, title: section.title.trim(), format: section.format, items }] : [];
    });
  }

  return content;
}
