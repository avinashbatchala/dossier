import { profileUnits } from "@/lib/ai/tasks/tailor-resume";
import type { Trimmed, Unit } from "@/lib/application-data";
import { documentLabels, type DocumentLabels } from "@/lib/document-labels";
import type { ProfileData } from "@/lib/profile";
import { resumeContent } from "@/lib/resume-content";
import { sectionOfUnit } from "@/lib/resume-sections";

// "Update from profile" (#301): a sent resume stopped following the profile,
// and its titles, dates and links can't be edited on the resume. This brings
// them up to date on request, with any items added since to sections the
// resume already has. The resume's own text stays, and nothing leaves it.

type CopiedProfile = Omit<ProfileData, "photo">;

/** The current entries, then the ones since deleted from the profile, which stay. Order doesn't matter: a resume follows its units. */
const merged = <T extends { id: string }>(old: readonly T[], now: readonly T[]): T[] => [...now, ...old.filter((entry) => !now.some(({ id }) => id === entry.id))];

/** A sent resume's copy, brought up to date. A section keeps the format it was sent in, since its parts are written for it; a new section stays out, for Add. */
function updatedCopy(copy: CopiedProfile, live: ProfileData): CopiedProfile {
  return {
    basics: live.basics,
    skills: merged(copy.skills, live.skills),
    languages: merged(copy.languages, live.languages),
    experience: merged(copy.experience, live.experience),
    projects: merged(copy.projects, live.projects),
    education: merged(copy.education, live.education),
    certifications: merged(copy.certifications, live.certifications),
    publications: merged(copy.publications, live.publications),
    references: merged(copy.references, live.references),
    customSections: copy.customSections.map((section) => {
      const now = live.customSections.find(({ id }) => id === section.id);
      return now ? { ...now, format: section.format, items: merged(section.items, now.items) } : section;
    }),
    facts: live.facts,
  };
}

/**
 * The resume's units with what's new in the sections it holds, each where the
 * profile has it. What's left out stays out; a section it doesn't hold is for
 * Add. An inline section is one part, so its new items join its lines.
 */
function withNewParts(units: readonly Unit[], trimmed: Trimmed | null, profile: ProfileData, labels: DocumentLabels): Unit[] {
  const next = units.map((unit) => ({ ...unit }));
  const leftOut = (trimmed ?? []).map((cut) => (cut.kind === "unit" ? cut.unit.id : cut.unitId));
  const held = new Set([...units.map((unit) => unit.id), ...leftOut]);
  const heldSections = new Set([...held].map((id) => sectionOfUnit(id, profile)));
  const parts = profileUnits(profile, labels);
  const place = new Map(parts.map((part, index) => [part.id, index]));

  for (const part of parts) {
    const section = sectionOfUnit(part.id, profile);
    if (part.id.startsWith("custom-inline:")) {
      const unit = next.find((entry) => entry.id === part.id);
      if (!unit) continue;
      const lines = unit.text.split("\n");
      unit.text = [...lines, ...part.text.split("\n").filter((line) => !lines.includes(line))].join("\n");
    } else if (!held.has(part.id) && heldSections.has(section)) {
      const sameSection = next.filter((unit) => sectionOfUnit(unit.id, profile) === section);
      const later = sameSection.find((unit) => (place.get(unit.id) ?? -1) > place.get(part.id)!);
      const index = later ? next.indexOf(later) : next.indexOf(sameSection.at(-1)!) + 1;
      next.splice(index, 0, part);
    }
  }
  return next;
}

/** What "Update from profile" would do to a resume, and whether that changes what it shows. */
export function profileUpdate({
  copy,
  live,
  units,
  trimmed,
  language,
  includeReferences,
}: {
  /** The profile it was sent with, or null for a draft, which follows the profile already. */
  copy: CopiedProfile | null;
  live: ProfileData;
  units: readonly Unit[];
  trimmed: Trimmed | null;
  language: string;
  includeReferences: boolean;
}): { copy: CopiedProfile | null; units: Unit[]; changed: boolean } {
  const labels = documentLabels(language);
  const nextCopy = copy && updatedCopy(copy, live);
  const profileOf = (held: CopiedProfile | null): ProfileData => (held ? { ...held, photo: null } : live);
  const nextUnits = withNewParts(units, trimmed, profileOf(nextCopy), labels);
  const shown = (profile: ProfileData, parts: readonly Unit[]) => JSON.stringify(resumeContent(profile, { units: [...parts], includeReferences }, labels));
  return { copy: nextCopy, units: nextUnits, changed: shown(profileOf(copy), units) !== shown(profileOf(nextCopy), nextUnits) };
}
