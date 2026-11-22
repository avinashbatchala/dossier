import type { CustomSection } from "@/lib/profile";
import { customKey, DEFAULT_SECTION_LAYOUT, profileRows } from "@/lib/resume-sections";

/**
 * The profile's sections, in the order they start in. Each one that goes on a
 * resume is one heading there, in the resume's usual order; Basics and the
 * Facts aren't headings. Optional ones don't count towards Profile strength (#216).
 */
export const SECTIONS = [
  {
    id: "basics",
    optional: false,
    label: "Basics",
    title: "The basics",
    hint: "How employers can reach you, the same for every profile. Only what you choose to show ends up on a resume.",
  },
  {
    id: "summary",
    optional: false,
    label: "Headline and summary",
    title: "Headline and summary",
    hint: "This profile's own title and a few lines about you: what you do, what you're good at and what you're looking for. Each application gets its own version.",
  },
  {
    id: "experience",
    optional: false,
    label: "Experience",
    title: "Work experience",
    hint: "Add the roles you're proud of. Rough bullet points are totally fine: each application gets its own polished version.",
  },
  {
    id: "volunteering",
    optional: true,
    label: "Volunteering",
    title: "Volunteering",
    hint: "Unpaid work for a cause or a community. Resumes show it apart from your jobs, and it doesn't count towards your years of experience.",
  },
  {
    id: "projects",
    optional: true,
    label: "Projects",
    title: "Projects",
    hint: "Side projects, open source, coursework or a thesis: things you built that show what you can do, especially when your roles don't say it yet.",
  },
  {
    id: "education",
    optional: false,
    label: "Education",
    title: "Education",
    hint: "Degrees and courses: anything that helps tell your story. Certifications have a section of their own.",
  },
  {
    id: "certifications",
    optional: true,
    label: "Certifications",
    title: "Certifications",
    hint: "Certificates and licences, with who issued them and how to check them. They go on resumes as written, in the order you set here.",
  },
  {
    id: "publications",
    optional: true,
    label: "Publications",
    title: "Publications",
    hint: "Papers, articles, books or chapters, cited your way. They go on resumes word for word, in the order you set here.",
  },
  {
    id: "references",
    optional: true,
    label: "References",
    title: "References",
    hint: "People who'll vouch for you. They stay private unless you include them.",
  },
  {
    id: "skills",
    optional: false,
    label: "Skills",
    title: "Skills",
    hint: "Type one and press Enter. Then attach them to your roles under Experience, so the AI knows where you used them.",
  },
  {
    id: "languages",
    optional: true,
    label: "Languages",
    title: "Languages",
    hint: "The languages you speak, and how well.",
  },
  {
    id: "facts",
    optional: true,
    label: "Facts about me",
    title: "Facts about me",
    hint: "What the AI should know about you that the rest of your profile doesn't say. It reads these when it writes your resumes and cover letters, and never copies them onto a resume as a list.",
  },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];
/** A section the user made (#298). */
type CustomSectionId = `custom:${string}`;
export type ProfileSectionId = SectionId | CustomSectionId;
/** What the Profile page can show: a section, the form that adds one (#338), or the jobs the profile is for (E24-3). */
export type ProfilePage = ProfileSectionId | "new" | "target";

export type NavSection = { id: ProfileSectionId; optional: boolean; label: string; title: string; hint: string };

/** The sections in the nav's order, which is also the order new resumes start with. */
export function navSections(customSections: readonly CustomSection[], order: readonly string[] = DEFAULT_SECTION_LAYOUT.order): NavSection[] {
  const custom = customSections.map(
    (section): NavSection => ({
      id: `custom:${section.id}`,
      optional: true,
      label: section.title.trim() || "Untitled section",
      title: section.title.trim() || "Untitled section",
      hint: "A section you made. It goes on resumes as written.",
    }),
  );
  const all: readonly NavSection[] = [...SECTIONS, ...custom];
  return profileRows(order, customSections.map((section) => customKey(section.id))).flatMap((key) => all.find((section) => section.id === key) ?? []);
}

/** The section in `?section=`, or Basics when it's missing or unknown. */
export function sectionFromParam(value: string | string[] | undefined, customSections: readonly CustomSection[] = []): ProfilePage {
  if (value === "new" || value === "target") return value;
  return navSections(customSections).find((section) => section.id === value)?.id ?? "basics";
}

/** A section of the Profile page, of a given profile (E24-2) or of the one last opened. */
export const sectionHref = (id: ProfilePage, profileId?: string) => `/profile?section=${id}${profileId ? `&profile=${profileId}` : ""}`;

/** Sections every profile shares (E33-1): the nav tags them "All profiles". */
export const SHARED_SECTIONS: ReadonlySet<string> = new Set(["basics", "languages", "facts"]);
