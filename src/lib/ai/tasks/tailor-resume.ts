import { z } from "zod";

import { unitsSchema, type Extracted, type Match, type Unit } from "@/lib/application-data";
import { publicationLabel } from "@/lib/citation";
import { documentLabels, ENGLISH_LABELS, languagesLine, type DocumentLabels } from "@/lib/document-labels";
import { customSectionUnits } from "@/lib/custom-section-units";
import { certificationLabel, resumeCertifications, resumeCustomSections, resumePublications, sameName, type ProfileData } from "@/lib/profile";
import { lineText } from "@/lib/changed-lines";
import { inEditorOrder, skillsText } from "@/lib/skill-groups";

import { guardSources, guardUnits } from "../fact-guard";

import {
  applicationFacts,
  candidateFacts,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  profileForPrompt,
  requirementTexts,
  servedRequirements,
  SERVES_RULE,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

const TAILOR_RESUME_VERSION = "tailor-resume@10";

/** A bullet, and which requirements it serves (E30-4); a plain line from a model that leaves them out. */
// Nullable as well as optional: strict JSON schemas (zodResponseFormat) refuse a field that's only optional.
const bulletSchema = z.union([z.string(), z.object({ text: z.string(), serves: z.array(z.number().int()).nullable().optional() })]);

const answerSchema = z.object({
  summary: z.string(),
  /** The requirements the summary serves (E30-4). */
  summaryServes: z.array(z.number().int()).nullable().optional(),
  roles: z.array(z.object({ id: z.string(), bullets: z.array(bulletSchema) })),
  projects: z.array(z.object({ id: z.string(), bullets: z.array(bulletSchema) })),
  /** The profile's skills, most relevant first; leave out ones that don't help. */
  skills: z.array(z.string()),
  education: z.array(z.object({ id: z.string(), notes: z.string() })),
});

const INSTRUCTIONS = `You tailor a candidate's resume to one job, as JSON.

- summary: 2–3 sentences in the first person without "I" at the start of every sentence, about the candidate as this job would see them.
- roles: every role from the profile, by id, with 2–5 bullets each, volunteering too. Lead with what this job cares about, keep each bullet to one line, and start with a verb.
- projects: every project from the profile, by id, with 1–3 bullets each, written like the roles' bullets: what was built and what it shows that this job cares about.
- skills: the candidate's own skills, most relevant to this job first. Copy their names exactly; you may leave out ones that don't help.
- education: every entry by id, with its notes shortened or left empty.
- The profile's certifications, publications and otherSections go on the resume word for word, so don't answer with them; the summary may mention them.
- Each bullet is {"text", "serves"}, and summaryServes is the summary's serves.`;

export type TailorInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted, for the fact guard. */
  posting: string;
  /** Keep the profile's order of skills, set by hand, instead of the most relevant first (public issue 62). */
  keepSkillOrder?: boolean;
};

/** APP-4: the tailored resume as units (summary, each role, each project, skills, each degree, each certification, each publication, languages). */
export const tailorResume: Task<TailorInput, Unit[]> = async (provider, { profile, extracted, match, facts, posting, keepSkillOrder = false }, options) => {
  const answer = await provider.complete({
    task: "tailor-resume",
    system: system(
      INSTRUCTIONS,
      SERVES_RULE,
      truthfulness(options.strict),
      candidateFacts(profile, facts),
      CREATIVITY[options.creativity],
      languageRule(options.language),
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, match, { numbered: true })}`,
          applicationFacts(facts),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "tailored_resume",
    creativity: options.creativity,
    signal: options.signal,
  });
  // The languages line in the resume's language: the chosen one, or the posting's.
  const units = resumeUnits(profile, answer, documentLabels(options.language ?? extracted.language), { keepSkillOrder, requirements: requirementTexts(extracted, match) });
  // E6-6: in strict mode, note what the profile and posting don't back.
  return {
    data: options.strict ? guardUnits(units, guardSources(profile, extracted, posting, facts)) : units,
    promptVersion: TAILOR_RESUME_VERSION,
  };
};

/**
 * Turns the answer into units, trusting nothing: unknown roles, projects and
 * degrees are dropped, skills must be the profile's own, and a role or
 * project the model skipped keeps its bullets from the profile. The certifications, publications,
 * custom sections and languages come from the profile, all but the languages word for word (#293, #218, #298),
 * and languages with their levels in the words of `labels`.
 */
export function resumeUnits(
  profile: ProfileData,
  answer: z.infer<typeof answerSchema>,
  labels: DocumentLabels = ENGLISH_LABELS,
  { keepSkillOrder = false, requirements = [] }: { keepSkillOrder?: boolean; requirements?: readonly string[] } = {},
): Unit[] {
  const roles = new Map(answer.roles.map((role) => [role.id, role.bullets]));
  const projects = new Map(answer.projects.map((project) => [project.id, project.bullets]));
  // A role's or project's lines, and which requirements each serves (E30-4).
  const lines = (bullets: z.infer<typeof bulletSchema>[] | undefined, fallback: string) => {
    const kept = (bullets ?? fallback.split("\n")).map((bullet) => (typeof bullet === "string" ? { text: bullet.trim() } : { text: bullet.text.trim(), serves: bullet.serves })).filter((bullet) => bullet.text);
    const serves = kept.flatMap((bullet) => {
      const served = servedRequirements("serves" in bullet ? bullet.serves : undefined, requirements);
      return served.length > 0 ? [{ line: lineText(bullet.text), requirements: served }] : [];
    });
    return { text: kept.map((bullet) => bullet.text).join("\n"), ...(serves.length > 0 ? { serves } : {}) };
  };
  const summaryServes = servedRequirements(answer.summaryServes, requirements);
  const notes = new Map(answer.education.map((entry) => [entry.id, entry.notes]));
  const kept = [...new Set(answer.skills.flatMap((name) => profile.skills.find((skill) => sameName(skill.name, name)) ?? []))];
  // In the profile's order when the user set one (public issue 62), else as the model ranked them.
  const skills = keepSkillOrder ? inEditorOrder(profile.skills).filter((skill) => kept.includes(skill)) : kept;
  const units: Unit[] = [
    {
      id: "summary",
      label: "Summary",
      text: answer.summary.trim(),
      ...(summaryServes.length > 0 ? { serves: [{ line: lineText(answer.summary), requirements: summaryServes }] } : {}),
    },
    ...profile.experience.map((entry) => ({
      id: `experience:${entry.id}`,
      label: `${entry.company || entry.role} ${entry.volunteering ? "volunteering" : "role"}`,
      ...lines(roles.get(entry.id), entry.bullets),
    })),
    ...profile.projects.map((entry) => ({ id: `project:${entry.id}`, label: `${entry.name || "Untitled"} project`, ...lines(projects.get(entry.id), entry.bullets) })),
    // Most relevant first, a line per group where its first skill comes (#280).
    { id: "skills", label: "Skills", text: skillsText(skills) },
    ...profile.education.map((entry) => ({
      id: `education:${entry.id}`,
      label: entry.degree || entry.school,
      text: (notes.get(entry.id) ?? entry.notes).trim(),
    })),
    ...resumeCertifications(profile.certifications).map((entry) => ({
      id: `certification:${entry.id}`,
      label: certificationLabel(entry.name),
      text: entry.name.trim(),
    })),
    ...resumePublications(profile.publications).map((entry) => ({
      id: `publication:${entry.id}`,
      label: publicationLabel(entry.citation),
      text: entry.citation.trim(),
    })),
    ...resumeCustomSections(profile.customSections).flatMap(customSectionUnits),
    {
      id: "languages",
      label: "Languages",
      text: languagesLine(profile.languages, labels),
    },
  ];
  return unitsSchema.parse(units);
}

/** The resume's units with the profile's own words, for adding a section to a resume that exists (#297). */
export function profileUnits(profile: ProfileData, labels: DocumentLabels = ENGLISH_LABELS): Unit[] {
  return resumeUnits(
    profile,
    { summary: profile.basics.summary, roles: [], projects: [], skills: inEditorOrder(profile.skills).map((skill) => skill.name), education: [] },
    labels,
  );
}
