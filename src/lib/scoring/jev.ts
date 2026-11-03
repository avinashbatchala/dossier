import "server-only";

import { MAX_POSTING_CHARACTERS, profileForPrompt } from "@/lib/ai/tasks/prompt-parts";
import type { PostingFit } from "@/lib/fit";
import type { ProfileData } from "@/lib/profile";

import { postingLines } from "./posting-lines";
import { askJev, typesafeError, type Answer, type AskOptions, type ChoiceQuestion, type NoulQuestion, type Question, type ScoreQuestion } from "./typesafe";

// Scoring a posting with Jev (#274), in place of the AI model's score-posting.
// Jev answers questions and writes nothing, so code builds the score from
// a few Scores (how much of the posting the profile covers, how close the
// past work is, the level) and the reasons from the posting's own lines:
// for each, whether it's asked of applicants and whether the profile shows it.

export const SCORE_POSTING_JEV_VERSION = "score-posting-jev@1";

export type JevPosting = { title: string; company: string; place: string; remote: boolean | null; salary: string; description: string };

const REQUIREMENTS: ScoreQuestion = {
  type: "score",
  instructions: "How much of what `posting` asks of applicants does `candidate` show?",
  criteria: [
    "Almost nothing the posting asks for shows in the candidate's profile.",
    "A few of the posting's requirements show in the profile; most of the core ones are missing.",
    "About half of the core requirements show in the profile; several important ones are missing.",
    "Most core requirements show in the profile, with one or two gaps.",
    "Every core requirement of the posting clearly shows in the profile.",
  ],
};

const WORK: ScoreQuestion = {
  type: "score",
  instructions: "How close is the work `candidate` has done, in their roles and projects, to the day-to-day work of the job in `posting`?",
  criteria: [
    "Unrelated: the candidate has done a different kind of work, in a different field.",
    "Loosely related: some overlap in tools or field, but the job's main work would be new to the candidate.",
    "Related: the candidate has done similar work, in another setting or with other tools.",
    "Closely matching: the candidate has done this kind of work before, in a comparable role.",
  ],
};

const SENIORITY: ScoreQuestion = {
  type: "score",
  instructions: "How well does the level of the job in `posting` (seniority, scope and responsibility) match the experience in `candidate`?",
  criteria: [
    "Far apart: for example a lead or principal role for someone early in their career, or an entry-level role for someone with many years of experience.",
    "A clear stretch up, or a clear step down, from the candidate's experience.",
    "A modest step up or down from the candidate's current level.",
    "The job's seniority and scope match the candidate's experience.",
  ],
};

const PLACE: NoulQuestion = {
  type: "noul",
  instructions: "Does `posting` require a location or a work permit that `candidate` can't meet?",
  criteria: {
    true: "The posting requires being in a place, or holding a work permit, and the candidate's profile shows they aren't there and the job isn't remote.",
    false: "The posting asks for no such thing, the job is remote, or the candidate's profile fits what it asks.",
  },
};

const LANGUAGE: NoulQuestion = {
  type: "noul",
  instructions: "Does `posting` require a language that `candidate.languages` doesn't include at the level the posting asks for?",
};

const THIN: NoulQuestion = {
  type: "noul",
  instructions: "Is `posting` too short or too vague to tell what the job requires of applicants?",
};

const KINDS = ["required", "preferred", "other"] as const;
type LineKind = (typeof KINDS)[number];

const lineKind = (line: string): ChoiceQuestion => ({
  type: "choice",
  instructions: { line, question: "What is `line`, a line from `posting`?" },
  criteria: {
    required: "Something applicants must bring: a skill, tool, kind or length of experience, degree, certificate, language or permit the job asks for.",
    preferred: "Something the job would like but doesn't require, for example marked as nice to have, a plus, a bonus or ideally.",
    other: "Not asked of applicants: about the company or team, the tasks of the job, benefits, pay, the hiring process or how to apply.",
  },
});

const lineShown = (line: string): NoulQuestion => ({
  type: "noul",
  instructions: { line, question: "Does `candidate` show what `line`, a line from `posting`, asks for?" },
  criteria: {
    true: "The candidate's skills, roles, projects, education, languages or facts show it, directly or clearly.",
    false: "Nothing in the candidate's profile shows it, or only something loosely related.",
  },
});

/** What Jev reads: the profile as the AI model gets it, without the name (it needs what was done, not who did it), and the posting. */
export function jevState(posting: JevPosting, profile: ProfileData) {
  const candidate = JSON.parse(profileForPrompt(profile)) as Record<string, unknown>;
  delete candidate.name;
  const { title, company, place, remote, salary, description } = posting;
  return { candidate, posting: { title, company, place, remote, salary, text: description.trim().slice(0, MAX_POSTING_CHARACTERS) } };
}

/** The questions, in one request: the Scores and Nouls about the whole posting, then two per line. */
export function jevQuestions(lines: readonly string[]): Record<string, Question> {
  return {
    requirements: REQUIREMENTS,
    work: WORK,
    seniority: SENIORITY,
    place: PLACE,
    language: LANGUAGE,
    thin: THIN,
    ...Object.fromEntries(
      lines.flatMap((line, index) => [
        [`line${index}Kind`, lineKind(line)],
        [`line${index}Shown`, lineShown(line)],
      ]),
    ),
  };
}

/** Jev's answers, each Score as 0 (its lowest level) to 1 (its highest), each Noul as the probability of yes. */
export type JevParts = {
  requirements: number;
  work: number;
  seniority: number;
  place: number;
  language: number;
  thin: number;
  lines: { text: string; kind: LineKind; shown: number }[];
};

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** The answers to `jevQuestions(lines)`; one missing or of the wrong kind means the answer can't be trusted. */
export function jevParts(answers: Record<string, Answer>, lines: readonly string[]): JevParts {
  const answer = <T extends Answer["type"]>(id: string, type: T) => {
    const found = answers[id];
    if (found?.type !== type) throw typesafeError("invalid-output", `TypeSafe answer without ${id}`);
    return found as Extract<Answer, { type: T }>;
  };
  const level = (id: string, question: ScoreQuestion) => clamp(answer(id, "score").score / (question.criteria.length - 1));
  const yes = (id: string) => clamp(answer(id, "noul").noul);
  return {
    requirements: level("requirements", REQUIREMENTS),
    work: level("work", WORK),
    seniority: level("seniority", SENIORITY),
    place: yes("place"),
    language: yes("language"),
    thin: yes("thin"),
    lines: lines.map((text, index) => {
      const { choice } = answer(`line${index}Kind`, "choice");
      return { text, kind: (KINDS as readonly string[]).includes(choice) ? (choice as LineKind) : "other", shown: yes(`line${index}Shown`) };
    }),
  };
}

/** How much each Score counts toward the score, relative to the others. */
export const JEV_WEIGHTS = { requirements: 0.5, work: 0.3, seniority: 0.2 } as const;
export type JevWeights = { [K in keyof typeof JEV_WEIGHTS]: number };

/** A Noul at or above this counts as yes, at or below NO as no (TypeSafe's suggested starting points). */
const YES = 0.7;
const NO = 0.3;
/** A location, permit or language the profile can't meet costs this much each. */
const MISMATCH_PENALTY = 15;
/** "If the posting is too thin to judge, score conservatively", as score-posting asks. */
const THIN_CAP = 60;
/** Close to a Score's top level: past its last step's midpoint. */
const HIGH = 5 / 6;
const MAX_REASONS = 4;
const MAX_RED_FLAGS = 3;
const MAX_COVERED = 3;
const QUOTE_LENGTH = 160;

/** 0 to 100: the weighted Scores, less the mismatches, and no more than THIN_CAP for a posting too thin to judge. */
export function jevScore(parts: JevParts, weights: JevWeights = JEV_WEIGHTS): number {
  const total = weights.requirements + weights.work + weights.seniority;
  let score = (100 * (weights.requirements * parts.requirements + weights.work * parts.work + weights.seniority * parts.seniority)) / total;
  if (parts.place >= YES) score -= MISMATCH_PENALTY;
  if (parts.language >= YES) score -= MISMATCH_PENALTY;
  if (parts.thin >= YES) score = Math.min(score, THIN_CAP);
  return Math.round(Math.min(100, Math.max(0, score)));
}

/** A line short enough to read as a reason, cut at a word. */
function quote(line: string): string {
  if (line.length <= QUOTE_LENGTH) return line;
  const cut = line.slice(0, QUOTE_LENGTH - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > QUOTE_LENGTH / 2 ? cut.slice(0, space) : cut}…`;
}

const COVERAGE = [
  "Little of what the posting asks for shows in your profile.",
  "Your profile shows a few of the posting's requirements.",
  "Your profile shows about half of what the posting asks for.",
  "Your profile shows most of what the posting asks for.",
  "Your profile shows everything the posting asks for.",
];

/**
 * The score, and the reasons and red flags in score-posting's limits: the
 * lines the profile covers ("Covers: …", required ones first), and the
 * required lines it doesn't ("Missing: …") after the mismatches.
 */
export function jevFit(parts: JevParts, weights: JevWeights = JEV_WEIGHTS): PostingFit {
  const covered = parts.lines
    .filter((line) => line.kind !== "other" && line.shown >= YES)
    .toSorted((a, b) => Number(b.kind === "required") - Number(a.kind === "required") || b.shown - a.shown);
  const missing = parts.lines.filter((line) => line.kind === "required" && line.shown <= NO);

  const reasons = [
    ...(parts.thin >= YES ? ["The posting says too little to judge the fit well."] : []),
    ...(covered.length > 0
      ? covered.slice(0, MAX_COVERED).map((line) => `Covers: ${quote(line.text)}`)
      : [COVERAGE[Math.round(parts.requirements * (COVERAGE.length - 1))]]),
    ...(parts.work >= HIGH ? ["Your past roles are close to this job's day-to-day work."] : []),
    ...(parts.seniority >= HIGH ? ["The role's level matches your experience."] : []),
  ];
  const redFlags = [
    ...(parts.place >= YES ? ["The posting asks for a location or work permit your profile doesn't show."] : []),
    ...(parts.language >= YES ? ["The posting asks for a language your profile doesn't list at that level."] : []),
    ...(parts.seniority < 1 - HIGH ? ["The role's level is far from your experience."] : []),
    ...missing.map((line) => `Missing: ${quote(line.text)}`),
  ];
  return { score: jevScore(parts, weights), reasons: reasons.slice(0, MAX_REASONS), redFlags: redFlags.slice(0, MAX_RED_FLAGS) };
}

/** Scores `posting` against `profile` with Jev, in one request; `scoredWith` names this version and Jev's. */
export async function scoreWithJev(posting: JevPosting, profile: ProfileData, options: AskOptions): Promise<{ data: PostingFit; scoredWith: string }> {
  const lines = postingLines(posting.description);
  const result = await askJev({ state: jevState(posting, profile), questions: jevQuestions(lines) }, options);
  return { data: jevFit(jevParts(result.answers, lines)), scoredWith: `${SCORE_POSTING_JEV_VERSION} (${result.model})` };
}
