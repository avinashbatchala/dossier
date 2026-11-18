import { z } from "zod";

import { LOCATION_FITS, SENIORITY_FITS, type FactorAnswers, type RequirementAnswer } from "@/lib/scoring/factors";
import {
  EDUCATION_LEVELS,
  EXTRA_LEVELS,
  levelAnswer,
  LOCATION_OPTIONS,
  REQUIREMENT_KINDS,
  scoringState,
  SENIORITY_OPTIONS,
  WORK_LEVELS,
  type ScoringPosting,
  type ScoringProfile,
} from "@/lib/scoring/questions";

import { MAX_POSTING_CHARACTERS, postingForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const SCORE_POSTING_VERSION = "score-posting@3";

// The AI model as a scoring model (E25-1, #408): it answers the engine's
// questions, the same ones decision models answer, as JSON with a reason for
// each factor. Dossier adds the answers up (src/lib/scoring/factors.ts).

const reasoned = z.object({ level: z.number(), reason: z.string() });
const answerSchema = z.object({
  requirements: z.array(z.object({ line: z.number(), kind: z.enum(["must", "nice", "other"]), covered: z.boolean(), evidence: z.string(), skill: z.string() })),
  work: reasoned,
  extra: reasoned,
  education: reasoned,
  seniority: z.object({ fit: z.enum(SENIORITY_FITS), reason: z.string() }),
  location: z.object({ fit: z.enum(LOCATION_FITS), reason: z.string() }),
  thin: z.boolean(),
});

const scale = (levels: readonly { means: string }[]) => levels.map((level, index) => `  ${index}: ${level.means}`).join("\n");
const options = (choices: Record<string, { means: string }>) =>
  Object.entries(choices)
    .map(([value, { means }]) => `  "${value}": ${means}`)
    .join("\n");

const INSTRUCTIONS = `You judge how well a job posting fits one of a candidate's profiles, as JSON. You don't give a score: you answer six questions, and the app adds the answers up.

1. requirements: for every numbered line of the posting, once each:
- kind:
${options(REQUIREMENT_KINDS)}
- covered: whether the candidate's profile shows what the line asks for, anywhere in it (skills, languages, facts, work experience, extra activities, education). Directly or clearly, never a stretch.
- evidence: when covered, the part of the profile that shows it, in a few words, such as "Senior Designer at Acme", "Figma (skill)", "Dutch (native)" or "MSc Computer Science"; otherwise "".
- skill: the one skill, tool or language the line is about, as the candidate would list it, such as "Figma" or "Kubernetes"; "" when it's about something else, such as years or a degree.

2. work: how close the paid work in candidate.workExperience is to the job's day-to-day work, a level from 0 to ${WORK_LEVELS.length - 1}:
${scale(WORK_LEVELS)}

3. extra: how much candidate.extraActivities support the candidate for the job, a level from 0 to ${EXTRA_LEVELS.length - 1}:
${scale(EXTRA_LEVELS)}

4. education: how well candidate.education meets what the posting asks for, a level from 0 to ${EDUCATION_LEVELS.length - 1}:
${scale(EDUCATION_LEVELS)}

5. seniority: where the job's level (its title, seniority, scope and the years it asks for) is against candidate.seniority.levels, the levels the candidate is looking for. The levels, lowest first: Internship, Entry level, Mid level, Senior, Lead or director. Use the roles and years only to read an unclear posting.
${options(SENIORITY_OPTIONS)}

6. location: whether the candidate can work where and how the job is, by candidate.location and any facts about work permits.
${options(LOCATION_OPTIONS)}

thin: true when the posting is too short or too vague to tell what the job requires of applicants.

Each reason is one short sentence to the candidate ("You…"), pointing at a specific part of the posting and of the profile. Never invent experience the profile doesn't show. Never use age, gender, nationality, ethnicity, religion, disability, family status or any other protected characteristic.`;

export type ScorePostingInput = {
  posting: ScoringPosting;
  /** The posting's lines, numbered from 0, as decision models get them (postingLines). */
  lines: readonly string[];
  profile: ScoringProfile;
  /** For the years of experience; today by default. */
  today?: Date;
};

const clampLevel = (level: number, count: number) => Math.min(count - 1, Math.max(0, Math.round(Number.isFinite(level) ? level : 0))) / (count - 1);
const trimmed = (text: string, max = 300) => text.trim().slice(0, max);

/** The answer as the engine's, trusting nothing: each line once, in range; a line it skipped isn't a requirement. */
export function factorsFrom(answer: z.infer<typeof answerSchema>, lines: readonly string[]): FactorAnswers {
  const byLine = new Map<number, (typeof answer.requirements)[number]>();
  for (const entry of answer.requirements) if (!byLine.has(entry.line)) byLine.set(entry.line, entry);
  const requirements = lines.flatMap((text, index): RequirementAnswer[] => {
    const entry = byLine.get(index);
    if (!entry || entry.kind === "other") return [];
    return [{ text, mustHave: entry.kind === "must", covered: entry.covered, evidence: entry.covered ? trimmed(entry.evidence, 120) || null : null, skill: trimmed(entry.skill, 60) || null }];
  });
  return {
    requirements,
    work: levelAnswer(clampLevel(answer.work.level, WORK_LEVELS.length), WORK_LEVELS, trimmed(answer.work.reason)),
    extra: levelAnswer(clampLevel(answer.extra.level, EXTRA_LEVELS.length), EXTRA_LEVELS, trimmed(answer.extra.reason)),
    education: levelAnswer(clampLevel(answer.education.level, EDUCATION_LEVELS.length), EDUCATION_LEVELS, trimmed(answer.education.reason)),
    seniority: { fit: answer.seniority.fit, reason: trimmed(answer.seniority.reason) || SENIORITY_OPTIONS[answer.seniority.fit].says },
    location: { fit: answer.location.fit, reason: trimmed(answer.location.reason) || LOCATION_OPTIONS[answer.location.fit].says },
    thin: answer.thin,
  };
}

/** E25-1: the engine's questions about a posting and one profile. Contact details, references and links are never sent. */
export const scorePosting: Task<ScorePostingInput, FactorAnswers> = async (provider, { posting, lines, profile, today = new Date() }, { signal }) => {
  const state = scoringState({ ...posting, description: posting.description.slice(0, MAX_POSTING_CHARACTERS) }, profile, today);
  const answer = await provider.complete({
    task: "score-posting",
    system: system(
      INSTRUCTIONS,
      "Use only facts that are in the candidate's profile. Never invent or assume an employer, skill, date or credential.",
      UNTRUSTED_POSTING,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate:\n${JSON.stringify(state.candidate, null, 2)}`,
          `The posting's facts:\n${JSON.stringify({ ...state.posting, text: undefined }, null, 2)}`,
          `The posting's lines:\n${lines.map((line, index) => `${index}: ${line}`).join("\n") || "(none)"}`,
          `The posting:\n${postingForPrompt(state.posting.text)}`,
        ].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "posting_factors",
    // Judging, not writing: faithful, and no long think before answering.
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  return { data: factorsFrom(answer, lines), promptVersion: SCORE_POSTING_VERSION };
};
