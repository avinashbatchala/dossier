import { z } from "zod";

import { addUp, FACTORS, fitLines, type Breakdown, type FactorAnswers } from "@/lib/scoring/factors";

// How well a posting fits a profile (#208, E16-2, E25): a score, with why.
// Shared by Positions, New application and the Agent screen. A score from the
// engine (E25) has its breakdown, one written in Claude chat too; one from
// before it has only its reasons and red flags.

export type PostingFit = {
  score: number;
  reasons: string[];
  redFlags: string[];
  /** How it adds up (E25-6); null for a score without one. */
  breakdown?: Breakdown | null;
};

/** A scoring model's answers, added up (E25-1), with the breakdown also as plain lines. */
export function fitFromAnswers(answers: FactorAnswers): PostingFit {
  const { score, breakdown } = addUp(answers);
  return { score, ...fitLines(breakdown), breakdown };
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
