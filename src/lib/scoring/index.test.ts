import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { MockProvider } from "@/lib/ai/providers/mock";
import { demoProfile } from "@/lib/demo-profile";
import { DEFAULT_WORKPLACE } from "@/lib/profile-workplace";

import type { ScoringConfig } from "./config";
import type { FactorAnswers } from "./factors";
import { loadPostingScorer, scoringProblem, testScorer } from "./index";

const state = vi.hoisted(() => ({
  config: { scorer: "AI", saved: false, keys: { JEV: { key: null, keyState: "none" } }, openrouterModel: "openai/gpt-6-luna" } as ScoringConfig,
  aiReady: true,
  provider: null as unknown,
}));

vi.mock("./config", async (importOriginal) => ({ ...(await importOriginal<typeof import("./config")>()), loadScoringConfig: async () => state.config }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => state.aiReady, loadAiConfig: async () => ({ timeoutMs: 60_000 }) }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () => state.provider,
  createProvider: () => state.provider,
}));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/usage-data", () => ({ recordUsage: vi.fn() }));
vi.mock("./profile", () => ({ loadScoringProfile: vi.fn() }));

const answers: FactorAnswers = {
  requirements: [{ text: "Figma", mustHave: true, covered: true, evidence: null }],
  work: { value: 1, reason: "Same work." },
  extra: { value: 1, reason: "Projects." },
  education: { value: 1, reason: "Degree." },
  seniority: { fit: "fits", reason: "Level." },
  location: { fit: "fits", reason: "Place." },
  thin: false,
};
vi.mock("./jev", () => ({ scoreWithJev: vi.fn(async () => ({ answers, scoredWith: "score-posting-jev@2 (jev-1.15.0)" })) }));
vi.mock("./typesafe", async (importOriginal) => ({ ...(await importOriginal<typeof import("./typesafe")>()), askJev: vi.fn(async () => ({ model: "jev-1.15.0", answers: {} })) }));

const { scoreWithJev } = await import("./jev");
const { recordUsage } = await import("@/lib/usage-data");

const profile = { data: demoProfile(), levels: { from: "senior" as const, to: "lead" as const }, workplace: DEFAULT_WORKPLACE };
const posting = { title: "Designer", company: "Ledgerly", place: "Amsterdam", remote: false, salary: "", description: "- You know Figma." };
const signal = new AbortController().signal;

beforeEach(() => {
  state.config = { scorer: "AI", saved: false, keys: { JEV: { key: null, keyState: "none" } }, openrouterModel: "openai/gpt-6-luna" };
  state.aiReady = true;
  vi.mocked(scoreWithJev).mockClear();
});

describe("scoringProblem (#274)", () => {
  it("asks for an AI provider, or for the chosen model's key", async () => {
    expect(await scoringProblem()).toBeNull();
    state.aiReady = false;
    expect(await scoringProblem()).toBe("Choose an AI provider in Settings → AI provider first.");

    state.config = { scorer: "JEV", saved: true, keys: { JEV: { key: null, keyState: "none" } }, openrouterModel: "openai/gpt-6-luna" };
    expect(await scoringProblem()).toBe("Enter your TypeSafe key in Settings → Scoring first.");
    expect(await scoringProblem({ ...state.config, keys: { JEV: { key: "ts", keyState: "set" } }, openrouterModel: "openai/gpt-6-luna" })).toBeNull();
  });
});

describe("loadPostingScorer (E25)", () => {
  it("scores with Jev and its key once chosen, and adds its answers up", async () => {
    state.config = { scorer: "JEV", saved: true, keys: { JEV: { key: "ts", keyState: "set" } }, openrouterModel: "openai/gpt-6-luna" };
    state.aiReady = false;
    const score = await loadPostingScorer();
    const { data, scoredWith } = await score(posting, profile, signal);
    expect(scoredWith).toBe("score-posting-jev@2 (jev-1.15.0)");
    expect(data).toMatchObject({ score: 100, breakdown: { cap: null, requirements: answers.requirements } });
    expect(data.reasons[0]).toBe("Requirements 35/35: You show 1 of 1 must-have.");
    // Jev's tokens go to the Usage screen (#290).
    expect(scoreWithJev).toHaveBeenCalledWith(posting, profile, { key: "ts", signal, onUsage: recordUsage });
  });

  it("scores with the AI model's score-posting otherwise, keeping its prompt version", async () => {
    const provider = new MockProvider({
      reply: () => ({
        requirements: [{ line: 0, kind: "must", covered: false, evidence: "", skill: "" }],
        work: { level: 3, reason: "" },
        extra: { level: 3, reason: "" },
        education: { level: 2, reason: "" },
        seniority: { fit: "fits", reason: "" },
        location: { fit: "fits", reason: "" },
        thin: false,
      }),
    });
    state.provider = provider;
    const score = await loadPostingScorer();
    const { data, scoredWith } = await score(posting, profile, signal);
    expect(scoredWith).toBe("score-posting@3");
    // The missing must-have costs its 35 points; the cap of 69 doesn't come into it.
    expect(data.score).toBe(65);
    expect(data.breakdown?.cap).toBeNull();
    expect(data.redFlags).toEqual(["Missing: You know Figma."]);
    expect(provider.calls[0].messages[0].content).toContain("0: You know Figma.");
    expect(scoreWithJev).not.toHaveBeenCalled();
  });

  it("fails with what's missing", async () => {
    state.aiReady = false;
    await expect(loadPostingScorer()).rejects.toThrow(new AiError("config", "Choose an AI provider in Settings → AI provider first."));
    state.config = { scorer: "JEV", saved: true, keys: { JEV: { key: null, keyState: "unreadable" } }, openrouterModel: "openai/gpt-6-luna" };
    await expect(loadPostingScorer()).rejects.toThrow("Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring.");
  });
});

describe("testScorer (E25-2)", () => {
  it("asks the chosen model one short question, or says what's missing", async () => {
    expect(await testScorer("JEV", 1000)).toEqual({ connected: false, message: "Enter your TypeSafe key in Settings → Scoring first." });
    state.config = { scorer: "JEV", saved: true, keys: { JEV: { key: "ts", keyState: "set" } }, openrouterModel: "openai/gpt-6-luna" };
    expect(await testScorer("JEV", 1000)).toEqual({ connected: true, model: "jev-1.15.0", seconds: expect.any(Number) });
  });
});

describe("OpenRouter as a scoring model (E25-4)", () => {
  it("asks the model chosen on OpenRouter, asks its companies not to keep what they're sent, and counts on its own Usage row", async () => {
    const { json, stubFetch } = await import("@/lib/ai/test-http");
    state.config = { scorer: "OPENROUTER", saved: true, keys: { OPENROUTER: { key: "sk-or", keyState: "set" } }, openrouterModel: "mistralai/mistral-small-2603" };
    const answer = {
      requirements: [{ line: 0, kind: "must", covered: true, evidence: "Figma (skill)", skill: "Figma" }],
      work: { level: 3, reason: "" },
      extra: { level: 1, reason: "" },
      education: { level: 2, reason: "" },
      seniority: { fit: "fits", reason: "" },
      location: { fit: "fits", reason: "" },
      thin: false,
    };
    const requests = stubFetch(() =>
      json({ id: "x", model: "mistralai/mistral-small-2603", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120 } }),
    );
    try {
      const score = await loadPostingScorer();
      const { data, scoredWith } = await score(posting, profile, signal);
      expect(scoredWith).toBe("score-posting@3 (mistralai/mistral-small-2603)");
      expect(data.breakdown?.requirements).toEqual([{ text: "You know Figma.", mustHave: true, covered: true, evidence: "Figma (skill)", skill: "Figma" }]);
      expect(requests[0].url.href).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(requests[0].headers.get("authorization")).toBe("Bearer sk-or");
      expect(requests[0].body).toMatchObject({ model: "mistralai/mistral-small-2603", provider: { data_collection: "deny" } });
      expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ task: "score-posting-openrouter", provider: "OPENROUTER", model: "mistralai/mistral-small-2603" }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("asks for its key first", async () => {
    state.config = { scorer: "OPENROUTER", saved: true, keys: { OPENROUTER: { key: null, keyState: "none" } }, openrouterModel: "openai/gpt-6-luna" };
    expect(await scoringProblem()).toBe("Enter your OpenRouter key in Settings → Scoring first.");
  });
});
