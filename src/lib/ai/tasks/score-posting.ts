import { z } from "zod";

import type { ProfileData } from "@/lib/profile";

import { postingForPrompt, profileForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const SCORE_POSTING_VERSION = "score-posting@1";

// The job agent's first look at a posting (E16-2): a cheap, explainable fit
// score before anything is spent on a draft. Adapted from avinashbatchala's
// fork of Dossier.

/** What the model answers; code checks and trims it (scoreFrom). */
const answerSchema = z.object({
  score: z.number(),
  reasons: z.array(z.string()),
  redFlags: z.array(z.string()),
});

/** How well a posting fits the profile: 0 to 100, one to four reasons, up to three red flags. */
export type PostingScore = { score: number; reasons: string[]; redFlags: string[] };

const INSTRUCTIONS = `You score how well a job posting fits a candidate before anyone writes an application, as JSON.

Judge only what the posting and the candidate's profile show:
- skills and experience against the posting's requirements;
- seniority and scope;
- location, remote work and language, when the posting states them;
- salary, when both the posting and the candidate's profile say something about it.

Give a score from 0 to 100:
- 85–100: excellent fit; the candidate clearly meets the core requirements.
- 70–84: good fit; most core requirements are covered, with a gap or two.
- 50–69: possible fit; meaningful gaps, or a stretch.
- 0–49: poor fit.

- reasons: one to four short sentences, each pointing at a specific requirement of the posting and a specific part of the profile (a role, a project, a skill, a degree). Never invent experience the profile doesn't show.
- redFlags: up to three real concerns, or none: a missing must-have skill, a seniority mismatch, a location or work-permit requirement the profile can't meet, or a language the candidate doesn't speak.

Never use age, gender, nationality, ethnicity, religion, disability, family status or any other protected characteristic. If the posting is too thin to judge, say so in a reason and score conservatively.`;

export type ScorePostingInput = {
  /** The posting's text, as the source gave it. */
  posting: string;
  title: string;
  company: string;
  place: string;
  remote: boolean | null;
  salary: string;
  profile: ProfileData;
};

const MAX_REASONS = 4;
const MAX_RED_FLAGS = 3;
const MAX_LENGTH = 300;

/** The answer, trusting nothing: a whole score within 0–100, and short, non-empty reasons and flags within their limits. */
export function scoreFrom(answer: z.infer<typeof answerSchema>): PostingScore {
  const clean = (lines: string[], max: number) =>
    lines
      .map((line) => line.trim().slice(0, MAX_LENGTH))
      .filter(Boolean)
      .slice(0, max);
  const reasons = clean(answer.reasons, MAX_REASONS);
  return {
    score: Math.min(100, Math.max(0, Math.round(Number.isFinite(answer.score) ? answer.score : 0))),
    reasons: reasons.length > 0 ? reasons : ["The model gave no reasons for this score."],
    redFlags: clean(answer.redFlags, MAX_RED_FLAGS),
  };
}

/** E16-2: how well a posting fits the profile. Contact details and references are never sent. */
export const scorePosting: Task<ScorePostingInput, PostingScore> = async (provider, input, { signal }) => {
  const { posting, profile, title, company, place, remote, salary } = input;
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
      "Use only facts that are in the candidate's profile. Never invent or assume an employer, skill, date or credential.",
      UNTRUSTED_POSTING,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The posting's facts:\n${JSON.stringify({ title, company, place, remote, salary }, null, 2)}`,
          `The posting:\n${postingForPrompt(posting)}`,
        ].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "posting_score",
    // Judging, not writing: faithful, and no long think before answering.
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  return { data: scoreFrom(answer), promptVersion: SCORE_POSTING_VERSION };
};
