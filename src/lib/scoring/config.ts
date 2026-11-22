import "server-only";

import { env, type Env } from "@/lib/env";
import { DECISIONS_KEY, decryptSecret, OPENROUTER_SCORING_KEY, SecretUnreadable, TYPESAFE_KEY, type SecretKind } from "@/lib/secrets";
import type { SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { OPENROUTER_SCORING_MODEL, SCORER_INFO, SCORERS, scorerKeyMissing, scorerKeyUnreadable, type Scorer, type ScoringKeyState, type ScoringView } from "./scorers";

// Which scoring model scores postings (#274, E25-2): the choice saved in
// Settings → Scoring, or else DOSSIER_SCORER, or else the AI model; and each
// model's key, saved there (encrypted for it only) or in its variable.

/** What each key is encrypted for, so a key saved for one can't be read as another's. */
export const SCORER_KEY_CONTEXT: Partial<Record<Scorer, SecretKind>> = { JEV: TYPESAFE_KEY, DECISIONS: DECISIONS_KEY, OPENROUTER: OPENROUTER_SCORING_KEY };

type ScorerKeyConfig = { key: string | null; keyState: ScoringKeyState };

export type ScoringConfig = {
  scorer: Scorer;
  /** Whether the choice is saved in Settings, rather than coming from DOSSIER_SCORER or the default. */
  saved: boolean;
  /** The keys of the models that need one. */
  keys: Partial<Record<Scorer, ScorerKeyConfig>>;
  /** The OpenRouter model that scores (E25-4). */
  openrouterModel: string;
};

const FROM_ENV: Record<NonNullable<Env["DOSSIER_SCORER"]>, Scorer> = { ai: "AI", jev: "JEV", "openai-decisions": "DECISIONS", openrouter: "OPENROUTER" };

type SavedKeys = Pick<SettingsData, "scorer" | "typesafeKeyEnc"> & Partial<Pick<SettingsData, "decisionsKeyEnc" | "openrouterScoringKeyEnc" | "openrouterScoringModel">>;
type KeyEnv = Pick<Env, "DOSSIER_SCORER" | "DOSSIER_TYPESAFE_KEY">;

export function resolveScoringConfig(saved: SavedKeys, source: KeyEnv, secret?: string): ScoringConfig {
  const scorer = saved.scorer ?? (source.DOSSIER_SCORER ? FROM_ENV[source.DOSSIER_SCORER] : "AI");
  const keys: Partial<Record<Scorer, ScorerKeyConfig>> = {};
  for (const id of SCORERS) {
    const info = SCORER_INFO[id].key;
    if (!info) continue;
    const stored = saved[info.setting];
    if (stored) {
      try {
        keys[id] = { key: decryptSecret(SCORER_KEY_CONTEXT[id]!, stored, secret), keyState: "set" };
      } catch (error) {
        if (!(error instanceof SecretUnreadable)) throw error;
        keys[id] = { key: null, keyState: "unreadable" };
      }
      continue;
    }
    const fromEnv = info.envName ? source[info.envName] : undefined;
    keys[id] = fromEnv ? { key: fromEnv, keyState: "env" } : { key: null, keyState: "none" };
  }
  return { scorer, saved: saved.scorer !== null, keys, openrouterModel: saved.openrouterScoringModel ?? OPENROUTER_SCORING_MODEL };
}

/** The scoring configuration in effect right now. */
export async function loadScoringConfig(): Promise<ScoringConfig> {
  return resolveScoringConfig(await loadSettings(), env);
}

export const scoringView = (config: ScoringConfig): ScoringView => ({
  scorer: config.scorer,
  keys: Object.fromEntries(Object.entries(config.keys).map(([id, key]) => [id, key.keyState])),
  openrouterModel: config.openrouterModel,
});

/** A scoring model's key, or why there isn't one, in words; a model without a key needs none. */
export function scorerKey(config: Pick<ScoringConfig, "keys">, scorer: Scorer): { key: string; problem: null } | { key: null; problem: string } {
  const found = config.keys[scorer];
  if (!SCORER_INFO[scorer].key) return { key: "", problem: null };
  if (found?.key) return { key: found.key, problem: null };
  return { key: null, problem: found?.keyState === "unreadable" ? scorerKeyUnreadable(scorer) : scorerKeyMissing(scorer) };
}
