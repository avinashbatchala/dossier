import "server-only";

import { AiError } from "@/lib/ai/errors";
import { fitFromAnswers, type PostingFit } from "@/lib/fit";

import { loadScoringConfig, type ScoringConfig } from "./config";
import { SCORING_MODELS } from "./models";
import type { ScoringPosting, ScoringProfile } from "./questions";
import type { Scorer } from "./scorers";

export { loadScoringProfile } from "./profile";

// Scoring a posting against a profile (#208, #274, E25): the scoring model
// Settings → Scoring chose answers the engine's questions, and Dossier adds
// the answers up with the weights and caps (factors.ts). Positions' Score,
// New application's score and the job agent all come here.

/** Scores one posting against one profile; `scoredWith` is kept with the score (PostingScore). */
export type PostingScorer = (posting: ScoringPosting, profile: ScoringProfile, signal: AbortSignal) => Promise<{ data: PostingFit; scoredWith: string }>;

/** Why postings can't be scored, in words, or null when the chosen scoring model is set up. */
export async function scoringProblem(config?: ScoringConfig): Promise<string | null> {
  const settled = config ?? (await loadScoringConfig());
  return SCORING_MODELS[settled.scorer].problem(settled);
}

/**
 * The scoring model Settings → Scoring chose, set up once for any number of
 * postings. Fails as an AiError when it isn't set up.
 */
export async function loadPostingScorer(): Promise<PostingScorer> {
  const config = await loadScoringConfig();
  const answer = await SCORING_MODELS[config.scorer].load(config);
  return async (posting, profile, signal) => {
    const { answers, scoredWith } = await answer(posting, profile, signal);
    return { data: fitFromAnswers(answers), scoredWith };
  };
}

/** "Test connection" for a scoring model (E25-2): one short question, timed. */
export async function testScorer(scorer: Scorer, timeoutMs: number): Promise<{ connected: true; model: string; seconds: number } | { connected: false; message: string }> {
  const config = await loadScoringConfig();
  const problem = await SCORING_MODELS[scorer].problem(config);
  if (problem) return { connected: false, message: problem };
  const started = performance.now();
  try {
    const { model } = await SCORING_MODELS[scorer].test(config, timeoutMs);
    return { connected: true, model, seconds: Math.round((performance.now() - started) / 100) / 10 };
  } catch (error) {
    if (error instanceof AiError) return { connected: false, message: error.message };
    throw error;
  }
}
