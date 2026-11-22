import { describe, expect, it, vi } from "vitest";

import { DECISIONS_KEY, encryptSecret, JOB_SOURCE_KEY, OPENROUTER_SCORING_KEY, TYPESAFE_KEY } from "@/lib/secrets";

import { resolveScoringConfig, scorerKey, scoringView } from "./config";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const nothingSaved = { scorer: null, typesafeKeyEnc: null };

describe("resolveScoringConfig (#274, E25-2)", () => {
  it("scores with the AI model until something chooses another, with each key's state", () => {
    expect(resolveScoringConfig(nothingSaved, {})).toEqual({ scorer: "AI", saved: false, keys: { JEV: { key: null, keyState: "none" }, DECISIONS: { key: null, keyState: "none" }, OPENROUTER: { key: null, keyState: "none" } }, openrouterModel: "openai/gpt-6-luna" });
    expect(resolveScoringConfig(nothingSaved, { DOSSIER_SCORER: "jev", DOSSIER_TYPESAFE_KEY: "ts_env" })).toMatchObject({ scorer: "JEV", saved: false, keys: { JEV: { key: "ts_env", keyState: "env" } } });
  });

  it("prefers what's saved in Settings to DOSSIER_SCORER and the key's variable", () => {
    const saved = { scorer: "AI" as const, typesafeKeyEnc: encryptSecret(TYPESAFE_KEY, "ts_saved") };
    expect(resolveScoringConfig(saved, { DOSSIER_SCORER: "jev", DOSSIER_TYPESAFE_KEY: "ts_env" })).toMatchObject({ scorer: "AI", saved: true, keys: { JEV: { key: "ts_saved", keyState: "set" } } });
  });

  it("calls a key saved under another secret, or for something else, unreadable rather than using the environment's", () => {
    for (const typesafeKeyEnc of [encryptSecret(TYPESAFE_KEY, "ts", "b".repeat(32)), encryptSecret(JOB_SOURCE_KEY, "ak")]) {
      expect(resolveScoringConfig({ scorer: "JEV", typesafeKeyEnc }, { DOSSIER_TYPESAFE_KEY: "ts_env" }).keys.JEV).toEqual({ key: null, keyState: "unreadable" });
    }
  });
});

describe("the keys of OpenAI Decisions and OpenRouter, and OpenRouter's model (E25-3, E25-4)", () => {
  it("reads each key encrypted for it only, and the model chosen or the default", () => {
    const saved = { ...nothingSaved, decisionsKeyEnc: encryptSecret(DECISIONS_KEY, "sk-decisions"), openrouterScoringKeyEnc: encryptSecret(DECISIONS_KEY, "sk-or"), openrouterScoringModel: "mistralai/mistral-small-2603" };
    expect(resolveScoringConfig(saved, {})).toMatchObject({
      keys: { DECISIONS: { key: "sk-decisions", keyState: "set" }, OPENROUTER: { key: null, keyState: "unreadable" } },
      openrouterModel: "mistralai/mistral-small-2603",
    });
    expect(resolveScoringConfig({ ...saved, openrouterScoringKeyEnc: encryptSecret(OPENROUTER_SCORING_KEY, "sk-or") }, {}).keys.OPENROUTER).toEqual({ key: "sk-or", keyState: "set" });
  });
});

describe("scorerKey and scoringView", () => {
  it("gives the key, or says what's missing; the AI model needs none", () => {
    expect(scorerKey({ keys: { JEV: { key: "ts", keyState: "set" } } }, "JEV")).toEqual({ key: "ts", problem: null });
    expect(scorerKey({ keys: { JEV: { key: null, keyState: "none" } } }, "JEV")).toEqual({ key: null, problem: "Enter your TypeSafe key in Settings → Scoring first." });
    expect(scorerKey({ keys: { JEV: { key: null, keyState: "unreadable" } } }, "JEV")).toEqual({ key: null, problem: "Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring." });
    expect(scorerKey({ keys: {} }, "AI")).toEqual({ key: "", problem: null });
  });

  it("never shows a key", () => {
    expect(scoringView({ scorer: "JEV", saved: true, keys: { JEV: { key: "ts_secret", keyState: "set" } }, openrouterModel: "openai/gpt-6-luna" })).toEqual({ scorer: "JEV", keys: { JEV: "set" }, openrouterModel: "openai/gpt-6-luna" });
  });
});
