import { z } from "zod";

import { addUp, FACTORS, fitLines, type Breakdown, type FactorAnswers } from "@/lib/scoring/factors";

// How well a posting fits a profile (#208, E16-2, E25): a score, with why.
// Shared by Positions, New application and the Agent screen. A score from the
// engine (E25) has its breakdown; one from before it, or written in Claude
// chat, has only its reasons and red flags.

export type PostingFit = {
  score: number;
  reasons: string[];
  redFlags: string[];
  /** How it adds up (E25-6); null for a score without one. */
  breakdown?: Breakdown | null;
};

/** The score's band: "Good fit". */
export function fitBand(score: number): string {
  if (score >= 85) return "Excellent fit";
  if (score >= 70) return "Good fit";
  if (score >= 50) return "Possible fit";
  return "Poor fit";
}

/** A scoring model's answers, added up (E25-1), with the breakdown also as plain lines. */
export function fitFromAnswers(answers: FactorAnswers): PostingFit {
  const { score, breakdown } = addUp(answers);
  return { score, ...fitLines(breakdown), breakdown };
}

const MAX_REASONS = 4;
const MAX_RED_FLAGS = 3;
const MAX_LENGTH = 300;

/** A score given whole, such as one written in Claude chat, trusting nothing: within 0–100, with short, non-empty reasons and flags within their limits. */
export function fitFrom(answer: { score: number; reasons: string[]; redFlags: string[] }): PostingFit {
  const clean = (lines: string[], max: number) =>
    lines
      .map((line) => line.trim().slice(0, MAX_LENGTH))
      .filter(Boolean)
      .slice(0, max);
  const reasons = clean(answer.reasons, MAX_REASONS);
  return {
    score: Math.min(100, Math.max(0, Math.round(Number.isFinite(answer.score) ? answer.score : 0))),
    reasons: reasons.length > 0 ? reasons : ["No reasons were given for this score."],
    redFlags: clean(answer.redFlags, MAX_RED_FLAGS),
  };
}

const factorIds = FACTORS.map((factor) => factor.id) as [Breakdown["factors"][number]["factor"], ...Breakdown["factors"][number]["factor"][]];

/** A stored breakdown (PostingScore.breakdown), or null for anything else. */
export const breakdownSchema = z.object({
  factors: z.array(z.object({ factor: z.enum(factorIds), points: z.number(), max: z.number(), reason: z.string() })),
  cap: z.object({ at: z.number(), reason: z.string() }).nullable(),
  requirements: z.array(z.object({ text: z.string(), mustHave: z.boolean(), covered: z.boolean(), evidence: z.string().nullable(), skill: z.string().nullable().optional() })),
});

export const breakdownOf = (stored: unknown): Breakdown | null => breakdownSchema.nullable().catch(null).parse(stored ?? null);

/** What scored it before the engine (E25): the AI model's score-posting@1 or @2, or Jev's first version. */
export const isOlderScore = (scoredWith: string) => /^(score-posting@[12]|score-posting-jev@1)\b/.test(scoredWith);
