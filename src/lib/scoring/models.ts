import "server-only";

import { AiError, createProvider, getAiProvider } from "@/lib/ai";
import { OpenAICompatibleProvider } from "@/lib/ai/providers/openai-compatible";
import { isAiConfigured, loadAiConfig } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { scorePosting } from "@/lib/ai/tasks";
import { recordUsage } from "@/lib/usage-data";

import { scorerKey, type ScoringConfig } from "./config";
import type { FactorAnswers } from "./factors";
import { askDecisions, scoreWithDecisions } from "./decisions";
import { scoreWithJev } from "./jev";
import { postingLines } from "./posting-lines";
import type { ScoringPosting, ScoringProfile } from "./questions";
import type { Scorer } from "./scorers";
import { askJev } from "./typesafe";

// The server side of each scoring model on the list (E25-2): how it scores,
// why it can't, and its connection test. Its name, key and Usage row are in
// src/lib/scoring/scorers.ts.

/** Answers the engine's questions about one posting and one profile; `scoredWith` names the version and model that answered. */
type AnswerPosting = (posting: ScoringPosting, profile: ScoringProfile, signal: AbortSignal) => Promise<{ answers: FactorAnswers; scoredWith: string }>;

export type ScoringModel = {
  /** Why it can't score right now, in words, or null. */
  problem: (config: ScoringConfig) => Promise<string | null>;
  /** Set up once for any number of postings; fails as an AiError when it isn't set up. */
  load: (config: ScoringConfig) => Promise<AnswerPosting>;
  /** One short question, for Test connection; fails as an AiError. */
  test: (config: ScoringConfig, timeoutMs: number) => Promise<{ model: string }>;
};

const AI_PROVIDER_MISSING = "Choose an AI provider in Settings → AI provider first.";

/** OpenRouter's API; the AI provider's rules for it (servers.ts) ask its model companies not to keep or train on what they're sent. */
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_TIMEOUT_MS = 120_000;

/** A provider for scoring with an OpenRouter model, its tokens counted on its own Usage row (E25-4). */
function openRouterScorer(key: string, model: string, timeoutMs = OPENROUTER_TIMEOUT_MS) {
  return new OpenAICompatibleProvider("OPENAI", OPENROUTER_URL, key, model, timeoutMs, (entry) =>
    recordUsage({ ...entry, task: entry.task === "score-posting" ? "score-posting-openrouter" : entry.task, provider: "OPENROUTER" }),
  );
}

/** Fails with the key's problem, or gives the key. */
function requireKey(config: ScoringConfig, scorer: Scorer): string {
  const found = scorerKey(config, scorer);
  if (found.problem !== null) throw AiError.config(found.problem);
  return found.key;
}

export const SCORING_MODELS: Record<Scorer, ScoringModel> = {
  AI: {
    problem: async () => ((await isAiConfigured()) ? null : AI_PROVIDER_MISSING),
    async load() {
      if (!(await isAiConfigured())) throw AiError.config(AI_PROVIDER_MISSING);
      const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
      return async (posting, profile, signal) => {
        const { data, promptVersion } = await scorePosting(provider, { posting, lines: postingLines(posting.description), profile }, { ...options, signal });
        return { answers: data, scoredWith: promptVersion };
      };
    },
    async test(_config, timeoutMs) {
      const config = await loadAiConfig();
      const { model } = await createProvider({ ...config, timeoutMs: Math.min(config.timeoutMs, timeoutMs) }).test();
      return { model };
    },
  },
  JEV: {
    problem: async (config) => scorerKey(config, "JEV").problem,
    async load(config) {
      const key = requireKey(config, "JEV");
      return (posting, profile, signal) => scoreWithJev(posting, profile, { key, signal, onUsage: recordUsage });
    },
    async test(config, timeoutMs) {
      const { model } = await askJev(
        { state: "Dossier is checking that it can reach Jev.", questions: { check: { type: "noul", instructions: "Is this text about checking a connection?" } } },
        { key: requireKey(config, "JEV"), timeoutMs, retryDelaysMs: [] },
      );
      return { model };
    },
  },
  DECISIONS: {
    problem: async (config) => scorerKey(config, "DECISIONS").problem,
    async load(config) {
      const key = requireKey(config, "DECISIONS");
      return (posting, profile, signal) => scoreWithDecisions(posting, profile, { key, signal, onUsage: recordUsage });
    },
    async test(config, timeoutMs) {
      const { model } = await askDecisions(
        { state: "Dossier is checking that it can reach OpenAI Decisions.", questions: { check: { type: "noul", instructions: "Is this text about checking a connection?" } } },
        { key: requireKey(config, "DECISIONS"), timeoutMs, retryDelaysMs: [] },
      );
      return { model };
    },
  },
  OPENROUTER: {
    problem: async (config) => scorerKey(config, "OPENROUTER").problem,
    async load(config) {
      const provider = openRouterScorer(requireKey(config, "OPENROUTER"), config.openrouterModel);
      const options = await loadTaskOptions();
      return async (posting, profile, signal) => {
        const { data, promptVersion } = await scorePosting(provider, { posting, lines: postingLines(posting.description), profile }, { ...options, signal });
        return { answers: data, scoredWith: `${promptVersion} (${config.openrouterModel})` };
      };
    },
    async test(config, timeoutMs) {
      const { model } = await openRouterScorer(requireKey(config, "OPENROUTER"), config.openrouterModel, timeoutMs).test();
      return { model };
    },
  },
};
