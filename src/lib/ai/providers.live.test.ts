import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AnthropicProvider } from "./providers/anthropic";
import { LmStudioProvider } from "./providers/lmstudio";
import { LocalProvider } from "./providers/local";
import { MistralProvider } from "./providers/mistral";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import type { AIProvider } from "./provider";
import { extractProfile } from "./tasks";
import { liveAnthropic, liveLmStudio, liveMistral } from "./test-live";

// Checks against real models, skipped unless asked for:
//
//   docker compose up -d ollama   # with qwen2.5:3b pulled (see compose.yml)
//   AI_LIVE=ollama docker/bin/yarn vitest run src/lib/ai/providers.live.test.ts
//   AI_LIVE=anthropic docker/bin/yarn vitest run src/lib/ai/providers.live.test.ts
//   AI_LIVE=mistral docker/bin/yarn vitest run src/lib/ai/providers.live.test.ts
//
// Anthropic's and Mistral's keys are DOSSIER_AI_KEY when that's set, or else
// the one saved in Settings → AI provider with that provider chosen.
// DOSSIER_AI_MODEL goes with DOSSIER_AI_KEY; Anthropic's checks use
// claude-haiku-4-5 when no model is given.
//
//   AI_LIVE=lmstudio docker/bin/yarn vitest run src/lib/ai/providers.live.test.ts
//
// LM Studio's model is DOSSIER_AI_MODEL (at DOSSIER_AI_URL, by default on the
// Docker host), or else the one saved in Settings with LM Studio chosen.
// A model that isn't loaded gets loaded, and stays loaded until ejected.
//
// AI_LIVE takes a comma-separated list. OLLAMA_URL and OLLAMA_MODEL override
// the defaults below.

const live = new Set((process.env.AI_LIVE ?? "").split(",").map((name) => name.trim()));
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://ollama:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";

const Posting = z.object({
  company: z.string(),
  role: z.string(),
  city: z.string(),
});
const posting = "Ledgerly is hiring a Senior Product Designer for its payments team in Amsterdam.";
const resume = `John Doe
Senior Product Designer · Utrecht, Netherlands · john.doe@example.com · example.com

Experience
Design Lead, Acme Payments, Utrecht | Mar 2021 to present
- Led the redesign of the payout flow
- Set up the design system in Figma
Product Designer, Fieldnote | 2017 – 2021
- Designed the mobile app's onboarding

Education
MSc Interaction Design, TU Delft, 2015 – 2017

Skills: Figma, Design systems, User research
Languages: Dutch (native), English (fluent)`;

function checks(name: string, make: () => AIProvider, model: string) {
  // The first call may have to load the model into memory.
  describe(name, { timeout: 300_000 }, () => {
    it("answers a prompt and a connection test", async () => {
      const provider = make();
      const text = await provider.complete({
        system: "Answer in one short sentence.",
        messages: [{ role: "user", content: "What colour is the sky on a clear day?" }],
        creativity: "FAITHFUL",
      });
      expect(text.toLowerCase()).toContain("blue");
      expect(await provider.test()).toMatchObject({ model, latencyMs: expect.any(Number) });
    });

    it("returns JSON that matches a schema", async () => {
      const result = await make().complete({
        system: "Extract the job details from the posting.",
        messages: [{ role: "user", content: posting }],
        schema: Posting,
        schemaName: "posting",
      });
      expect(result).toMatchObject({ company: "Ledgerly", city: "Amsterdam" });
      expect(result.role).toMatch(/product designer/i);
    });

    it("lists its models", async () => {
      expect(await make().listModels()).toContain(model);
    });
  });
}

describe.runIf(live.has("ollama"))("live: Ollama", () => {
  checks("native API", () => new LocalProvider(OLLAMA_URL, OLLAMA_MODEL, 300_000), OLLAMA_MODEL);
  checks("OpenAI-compatible /v1", () => new OpenAICompatibleProvider("OPENAI", `${OLLAMA_URL}/v1`, null, OLLAMA_MODEL, 300_000), OLLAMA_MODEL);

  it("names a model that isn't installed", async () => {
    await expect(new LocalProvider(OLLAMA_URL, "no-such-model:1b", 60_000).test()).rejects.toMatchObject({ kind: "model" });
  });
});

const anthropic = live.has("anthropic") ? await liveAnthropic() : null;

describe.runIf(anthropic)("live: Anthropic", () => {
  const { key, model } = anthropic ?? { key: "", model: "" };
  const make = (apiKey = key) => new AnthropicProvider("https://api.anthropic.com", apiKey, model, 120_000);
  checks("Messages API", () => make(), model);

  // The profile's schema is more than structured output takes, so it goes in the prompt (#230).
  it("imports a profile from a resume", { timeout: 300_000 }, async () => {
    const { data } = await extractProfile(make(), { resume }, { creativity: "FAITHFUL", strict: true, language: null });
    expect(data.basics).toMatchObject({ name: "John Doe", email: "john.doe@example.com", city: "Utrecht" });
    expect(data.experience.map((entry) => entry.company)).toEqual(["Acme Payments", "Fieldnote"]);
    expect(data.education).toHaveLength(1);
    expect(data.skills.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a wrong key in plain words", async () => {
    await expect(make("sk-ant-wrong").test()).rejects.toMatchObject({ kind: "auth" });
  });
});

const mistral = live.has("mistral") ? await liveMistral() : null;

describe.runIf(mistral)("live: Mistral", () => {
  const { key, model } = mistral ?? { key: "", model: "" };
  const make = (apiKey = key) => new MistralProvider("https://api.mistral.ai/v1", apiKey, model, 120_000);
  checks("chat completions", () => make(), model);

  it("answers a reading task in plain JSON", async () => {
    const result = await make().complete({
      system: "Extract the job details from the posting.",
      messages: [{ role: "user", content: posting }],
      schema: Posting,
      schemaName: "posting",
      effort: "low",
    });
    expect(result).toMatchObject({ company: "Ledgerly", city: "Amsterdam" });
  });

  it("refuses a wrong key in plain words", async () => {
    await expect(make("wrong-key").test()).rejects.toMatchObject({ kind: "auth" });
  });
});

const lmStudio = live.has("lmstudio") ? await liveLmStudio() : null;

describe.runIf(lmStudio)("live: LM Studio", () => {
  const { url, key, model } = lmStudio ?? { url: "", key: null, model: "" };
  const make = (name = model) => new LmStudioProvider(url, key, name, 300_000);
  checks("OpenAI-compatible endpoint", () => make(), model);

  it("answers a reading task in plain JSON, with thinking off", async () => {
    const result = await make().complete({
      system: "Extract the job details from the posting.",
      messages: [{ role: "user", content: posting }],
      schema: Posting,
      schemaName: "posting",
      effort: "low",
    });
    expect(result).toMatchObject({ company: "Ledgerly", city: "Amsterdam" });
  });

  it("refuses a model it doesn't have", async () => {
    await expect(make("no-such-model").test()).rejects.toMatchObject({ kind: "model" });
  });

  it("is found by Local model too", async () => {
    expect(await new LocalProvider(url, model, 300_000).test()).toMatchObject({ model });
  });
});
