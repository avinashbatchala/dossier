/** The profile's sections, in order: skills come before experience so they can be attached to roles. */
export const SECTIONS = [
  {
    id: "basics",
    label: "Basics",
    title: "The basics",
    hint: "How employers can reach you. Only what you choose to show ends up on a resume.",
  },
  {
    id: "skills",
    label: "Skills & languages",
    title: "Skills & languages",
    hint: "Type one and press Enter. Next, you'll attach them to each role under Experience so the AI knows where you used them.",
  },
  {
    id: "experience",
    label: "Experience",
    title: "Work experience",
    hint: "Add the roles you're proud of. Rough bullet points are totally fine: each application gets its own polished version.",
  },
  {
    id: "projects",
    label: "Projects",
    title: "Projects",
    hint: "Side projects, open source, coursework or a thesis: things you built that show what you can do, especially when your roles don't say it yet.",
  },
  {
    id: "education",
    label: "Education",
    title: "Education",
    hint: "Degrees, courses, certificates: anything that helps tell your story.",
  },
  {
    id: "references",
    label: "References",
    title: "References",
    hint: "People who'll vouch for you. They stay private unless you include them.",
  },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** The section in `?section=`, or Basics when it's missing or unknown. */
export function sectionFromParam(value: string | string[] | undefined): SectionId {
  return SECTIONS.find((section) => section.id === value)?.id ?? "basics";
}

export const sectionHref = (id: SectionId) => `/profile?section=${id}`;
