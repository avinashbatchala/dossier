import { describe, expect, it, vi } from "vitest";

import { encryptSecret, JOB_SOURCE_KEY, TYPESAFE_KEY } from "@/lib/secrets";

import { jevKey, resolveScoringConfig, scoringView } from "./config";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const nothingSaved = { scorer: null, typesafeKeyEnc: null };

describe("resolveScoringConfig (#274)", () => {
  it("scores with the AI model until something chooses Jev", () => {
    expect(resolveScoringConfig(nothingSaved, {})).toEqual({ scorer: "AI", saved: false, key: null, keyState: "none" });
    expect(resolveScoringConfig(nothingSaved, { DOSSIER_SCORER: "jev", DOSSIER_TYPESAFE_KEY: "ts_env" })).toEqual({ scorer: "JEV", saved: false, key: "ts_env", keyState: "env" });
  });

  it("prefers what's saved in Settings to DOSSIER_SCORER and DOSSIER_TYPESAFE_KEY", () => {
    const saved = { scorer: "AI" as const, typesafeKeyEnc: encryptSecret(TYPESAFE_KEY, "ts_saved") };
    expect(resolveScoringConfig(saved, { DOSSIER_SCORER: "jev", DOSSIER_TYPESAFE_KEY: "ts_env" })).toEqual({ scorer: "AI", saved: true, key: "ts_saved", keyState: "set" });
  });

  it("calls a key saved under another secret, or for something else, unreadable rather than using the environment's", () => {
    for (const typesafeKeyEnc of [encryptSecret(TYPESAFE_KEY, "ts", "b".repeat(32)), encryptSecret(JOB_SOURCE_KEY, "ak")]) {
      expect(resolveScoringConfig({ scorer: "JEV", typesafeKeyEnc }, { DOSSIER_TYPESAFE_KEY: "ts_env" })).toEqual({ scorer: "JEV", saved: true, key: null, keyState: "unreadable" });
    }
  });
});

describe("jevKey and scoringView", () => {
  it("gives the key, or says what's missing", () => {
    expect(jevKey({ key: "ts", keyState: "set" })).toEqual({ key: "ts", problem: null });
    expect(jevKey({ key: null, keyState: "none" })).toEqual({ key: null, problem: "Enter your TypeSafe key in Settings → Scoring first." });
    expect(jevKey({ key: null, keyState: "unreadable" })).toEqual({ key: null, problem: "Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring." });
  });

  it("never shows the key", () => {
    expect(scoringView({ scorer: "JEV", saved: true, key: "ts_secret", keyState: "set" })).toEqual({ scorer: "JEV", keyState: "set" });
  });
});
