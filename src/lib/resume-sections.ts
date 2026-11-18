import { z } from "zod";

import type { CustomSection, ProfileData } from "@/lib/profile";
import { isCustomUnit } from "@/lib/unit-text";

// A resume's sections: the order they're drawn in and which are off (#297).
// The base resume keeps its own in Settings; an application follows it until
// it has one of its own. Each section is one heading on a resume, so one
// profile section can be two of them, such as Experience and Volunteering.

/** The built-in sections, in the order a resume has drawn them since before they could be moved. */
export const BUILT_IN_SECTIONS = [
  "summary",
  "experience",
  "volunteering",
  "projects",
  "education",
  "certifications",
  "publications",
  "references",
  "skills",
  "languages",
] as const;
export type BuiltInSection = (typeof BUILT_IN_SECTIONS)[number];

/** What each built-in section is called on the screens that move them. */
const SECTION_NAMES: Record<BuiltInSection, string> = {
  summary: "Summary",
  experience: "Experience",
  volunteering: "Volunteering",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  publications: "Publications",
  references: "References",
  skills: "Skills",
  languages: "Languages",
};

/**
 * Rows of the Profile page that aren't headings on a resume: Basics is its
 * header, and the Facts are never printed. They keep a place in the order for
 * the list's sake, and resumes don't draw them.
 */
const PROFILE_ONLY_SECTIONS = ["basics", "facts"] as const;

/** A custom section's key (#298). */
export const customKey = (sectionId: string) => `custom:${sectionId}`;
export const isCustomKey = (key: string) => key.startsWith("custom:");

/** A section's name on the screens that move them. */
export function sectionName(key: string, customSections: readonly CustomSection[]): string {
  const custom = customSections.find((section) => customKey(section.id) === key);
  return custom ? custom.title.trim() || "Untitled section" : (SECTION_NAMES[key as BuiltInSection] ?? key);
}

/** Whether a sidebar layout keeps a section in its sidebar, whatever its place in the order: skills, languages, and custom sections drawn like them. */
export function inSidebar(key: string, customSections: readonly CustomSection[]): boolean {
  return key === "skills" || key === "languages" || customSections.some((section) => customKey(section.id) === key && section.format === "INLINE");
}

export const sectionLayoutSchema = z.object({
  /** Section keys in drawing order; one it doesn't list goes in its usual place (see `arrangedSections`). */
  order: z.array(z.string().max(100)).max(200),
  /** Sections taken off the resume, which keep their content. */
  off: z.array(z.string().max(100)).max(200).default([]),
  /** References added to this resume by hand, whatever Settings → "Include references" says. */
  withReferences: z.boolean().optional(),
  /** Headings this resume calls something else (#339), by section key. */
  titles: z.record(z.string().max(100), z.string().max(100)).optional(),
});
export type SectionLayout = z.infer<typeof sectionLayoutSchema>;

/** Nobody has moved anything: today's order, which is how resumes were always drawn. */
export const DEFAULT_SECTION_LAYOUT: SectionLayout = { order: [...BUILT_IN_SECTIONS], off: [] };

/** A section's heading on a resume: what that resume calls it, or else the usual one. */
export function sectionHeading(layout: SectionLayout, key: string, usual: string): string {
  return layout.titles?.[key]?.trim() || usual;
}

/** The layout with a section's heading changed; an empty one goes back to the usual. */
export function withHeading(layout: SectionLayout, key: string, title: string): SectionLayout {
  const others = Object.entries(layout.titles ?? {}).filter(([entry]) => entry !== key);
  return { ...layout, titles: Object.fromEntries(title.trim() ? [...others, [key, title.trim()]] : others) };
}

/**
 * Every section in drawing order: the list's order, without what no longer
 * exists. A built-in section the list doesn't have, such as one a later
 * version adds, goes after the one it usually follows; a custom section it
 * doesn't have yet goes above References (#298).
 */
export function arrangedSections(order: readonly string[], customKeys: readonly string[] = []): string[] {
  const known = new Set<string>([...BUILT_IN_SECTIONS, ...PROFILE_ONLY_SECTIONS, ...customKeys]);
  const arranged = [...new Set(order)].filter((key) => known.has(key));
  BUILT_IN_SECTIONS.forEach((key, index) => {
    if (!arranged.includes(key)) arranged.splice(index === 0 ? 0 : arranged.indexOf(BUILT_IN_SECTIONS[index - 1]) + 1, 0, key);
  });
  for (const key of customKeys) {
    if (!arranged.includes(key)) arranged.splice(arranged.indexOf("references"), 0, key);
  }
  return arranged;
}

/** The sections to draw, given the keys that have something to show. */
export function shownSections(layout: SectionLayout, withContent: readonly string[]): string[] {
  return arrangedSections(layout.order, withContent.filter(isCustomKey)).filter((key) => withContent.includes(key) && !layout.off.includes(key));
}

/**
 * The whole order after moving what's on screen: `moved` holds the keys
 * being reordered in their new order; the rest, such as empty sections, keep
 * their places.
 */
export function withMoved(order: readonly string[], moved: readonly string[]): string[] {
  const queue = [...moved];
  const moving = new Set(moved);
  // Custom sections stay listed even while they're gone: Undo puts one back in its place.
  const custom = [...order, ...moved].filter(isCustomKey);
  return arrangedSections(order, custom).map((key) => (moving.has(key) ? queue.shift()! : key));
}

/** The Profile page's rows, in the one order Profile and the base resume share: Basics first and the Facts last until they're moved. */
export function profileRows(order: readonly string[], customKeys: readonly string[] = []): string[] {
  const arranged = arrangedSections(order, customKeys);
  if (!arranged.includes("basics")) arranged.unshift("basics");
  if (!arranged.includes("facts")) arranged.push("facts");
  return arranged;
}

/** The whole order after moving the Profile page's rows, which are all there but for deleted custom sections, whose place stays for Undo. */
export function withProfileRows(order: readonly string[], rows: readonly string[]): string[] {
  return withMoved(profileRows(order, [...order, ...rows].filter(isCustomKey)), rows);
}

/** The section a resume part belongs to, or null for a part that's no section's, such as an unknown one. */
export function sectionOfUnit(unitId: string, profile: ProfileData): string | null {
  if (unitId === "summary" || unitId === "skills" || unitId === "languages") return unitId;
  if (unitId.startsWith("experience:")) {
    const role = profile.experience.find((entry) => `experience:${entry.id}` === unitId);
    return role?.volunteering ? "volunteering" : "experience";
  }
  if (unitId.startsWith("project:")) return "projects";
  if (unitId.startsWith("education:")) return "education";
  if (unitId.startsWith("certification:")) return "certifications";
  if (unitId.startsWith("publication:")) return "publications";
  if (isCustomUnit(unitId)) {
    const itemId = unitId.slice(unitId.indexOf(":") + 1);
    const section = profile.customSections.find((entry) => entry.id === itemId || entry.items.some((item) => item.id === itemId));
    return section ? customKey(section.id) : null;
  }
  return null;
}

/**
 * The profile as the AI should see it for a new application: without the
 * sections that are off (#297). Skills, languages and the summary stay, since
 * roles and letters lean on them; those are only left off the page.
 */
export function withoutSectionsOff(profile: ProfileData, { off }: SectionLayout): ProfileData {
  const isOff = (key: BuiltInSection) => off.includes(key);
  return {
    ...profile,
    experience: [
      ...(isOff("experience") ? profile.experience.filter((entry) => entry.volunteering) : profile.experience),
    ].filter((entry) => !(isOff("volunteering") && entry.volunteering)),
    projects: isOff("projects") ? [] : profile.projects,
    education: isOff("education") ? [] : profile.education,
    certifications: isOff("certifications") ? [] : profile.certifications,
    publications: isOff("publications") ? [] : profile.publications,
    customSections: profile.customSections.filter((section) => !off.includes(customKey(section.id))),
  };
}
