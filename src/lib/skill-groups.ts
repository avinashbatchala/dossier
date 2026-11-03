// Skill groups (#280): a skill can belong to a group, and resumes print one
// labelled line per group ("Technical SEO: Crawl budget · Log analysis").
// The Skills unit stays text, a line per group, so it can be edited like
// any other part of a resume.

export type GroupedSkill = { name: string; group: string };

/** The groups and their skills, each group where its first skill is; skills without a group are the group "". */
export function skillGroups<T extends GroupedSkill>(skills: readonly T[]): { group: string; skills: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const skill of skills) {
    const group = skill.group.trim();
    groups.set(group, [...(groups.get(group) ?? []), skill]);
  }
  return [...groups].map(([group, members]) => ({ group, skills: members }));
}

/** Skills as Profile → Skills shows them: those without a group first, then each group, where its first skill is. */
export function inEditorOrder<T extends GroupedSkill>(skills: readonly T[]): T[] {
  const groups = skillGroups(skills);
  return [...groups.filter(({ group }) => !group), ...groups.filter(({ group }) => group)].flatMap(({ skills: members }) => members);
}

/** The Skills unit: a line per group, in the order its skills come ("Tools: Figma · Ahrefs"), and skills without a group on a line without a label. */
export function skillsText(skills: readonly GroupedSkill[]): string {
  return skillGroups(skills)
    .map(({ group, skills: members }) => `${group ? `${group}: ` : ""}${members.map((skill) => skill.name).join(" · ")}`)
    .join("\n");
}

const LABEL = /^([^:·\n]{1,60}):\s+/;

/** A line of the Skills unit, as its group's label (or none) and its skills. */
export function skillLine(line: string): { label: string | null; text: string } {
  const match = LABEL.exec(line);
  return match ? { label: match[1].trim(), text: line.slice(match[0].length) } : { label: null, text: line };
}

/** The skills named in the Skills unit, without the labels. */
export function skillNamesIn(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => skillLine(line.trim()).text.split(" · "))
    .map((name) => name.trim())
    .filter(Boolean);
}
