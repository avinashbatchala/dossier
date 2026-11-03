import "server-only";

import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { scorePosting } from "@/lib/ai/tasks";
import type { PostingFit } from "@/lib/fit";
import { postingText, type FoundPosting } from "@/lib/job-search/search";
import type { ProfileData } from "@/lib/profile";

import { jevKey, loadScoringConfig, type ScoringConfig } from "./config";
import { scoreWithJev } from "./jev";

// Scoring a posting against the profile (#208, #274), with whatever Settings →
// Scoring chose: the AI model's score-posting, or Jev. Find jobs' Score and
// the job agent both come here.

export type ScorablePosting = Pick<FoundPosting, "title" | "company" | "place" | "remote" | "salary" | "description">;

/** Scores one posting; `scoredWith` is kept with the score (PostingScore). */
export type PostingScorer = (posting: ScorablePosting, profile: ProfileData, signal: AbortSignal) => Promise<{ data: PostingFit; scoredWith: string }>;

export const AI_PROVIDER_MISSING = "Choose an AI provider in Settings → AI provider first.";

/** Why postings can't be scored, in words, or null when the chosen scorer is set up. */
export async function scoringProblem(config?: ScoringConfig): Promise<string | null> {
  const settled = config ?? (await loadScoringConfig());
  if (settled.scorer === "JEV") return jevKey(settled).problem;
  return (await isAiConfigured()) ? null : AI_PROVIDER_MISSING;
}

/**
 * The scorer Settings → Scoring chose, set up once for any number of
 * postings. Fails as an AiError when it isn't set up.
 */
export async function loadPostingScorer(): Promise<PostingScorer> {
  const config = await loadScoringConfig();
  if (config.scorer === "JEV") {
    const jev = jevKey(config);
    if (jev.problem !== null) throw AiError.config(jev.problem);
    const { key } = jev;
    return (posting, profile, signal) => scoreWithJev(posting, profile, { key, signal });
  }
  if (!(await isAiConfigured())) throw AiError.config(AI_PROVIDER_MISSING);
  const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
  return async (posting, profile, signal) => {
    const { title, company, place, remote, salary } = posting;
    const { data, promptVersion } = await scorePosting(provider, { posting: postingText(posting), title, company, place, remote, salary, profile }, { ...options, signal });
    return { data, scoredWith: promptVersion };
  };
}
