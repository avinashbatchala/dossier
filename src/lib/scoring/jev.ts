import "server-only";

import { MAX_POSTING_CHARACTERS } from "@/lib/ai/tasks/prompt-parts";
import type { UsageSink } from "@/lib/usage";

import type { FactorAnswers } from "./factors";
import { postingLines } from "./posting-lines";
import { answersFromTyped, engineQuestions, scoringState, type ScoringPosting, type ScoringProfile } from "./questions";
import { askJev, typesafeError, type AskOptions } from "./typesafe";

// Jev as a scoring model (#274, E25-1): it answers the engine's typed
// questions about the posting's lines and the five other factors in one
// request, and writes nothing, so each factor's line says what its level means.

export const SCORE_POSTING_JEV_VERSION = "score-posting-jev@2";

/** What Jev reads: the posting, cut as the AI model gets it, and the profile grouped by factor. */
export function jevState(posting: ScoringPosting, profile: ScoringProfile, today = new Date()) {
  return scoringState({ ...posting, description: posting.description.trim().slice(0, MAX_POSTING_CHARACTERS) }, profile, today);
}

/**
 * Asks Jev the engine's questions about `posting` and one profile, in one
 * request; `scoredWith` names this version and Jev's. `onUsage` gets its
 * tokens: TypeSafe reports the input only.
 */
export async function scoreWithJev(
  posting: ScoringPosting,
  profile: ScoringProfile,
  { onUsage, ...options }: AskOptions & { onUsage?: UsageSink },
): Promise<{ answers: FactorAnswers; scoredWith: string }> {
  const lines = postingLines(posting.description);
  const result = await askJev({ state: jevState(posting, profile), questions: engineQuestions(lines) }, options);
  onUsage?.({ task: "score-posting-jev", provider: "JEV", model: result.model, input: result.usage?.input_tokens ?? null, output: null });
  const answers = answersFromTyped(result.answers, lines, (detail) => typesafeError("invalid-output", `TypeSafe answer: ${detail}`));
  return { answers, scoredWith: `${SCORE_POSTING_JEV_VERSION} (${result.model})` };
}
