import { describe, expect, it, vi } from "vitest";

import { encryptApiKey } from "./api-key";
import { isAiUsable, resolveAiConfig } from "./config";
import { AiError } from "./errors";
import { createProvider } from "./index";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const saved = vi.hoisted(() => ({ settings: { provider: null, baseUrl: null, model: null, apiKeyEnc: null } as Record<string, unknown> }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => saved.settings }));

const noEnv = {} as Parameters<typeof resolveAiConfig>[1];
const nothingSaved = { provider: null, baseUrl: null, model: null, apiKeyEnc: null };

describe("resolveAiConfig", () => {
  it("defaults to a local model on the standard Ollama address", () => {
    expect(resolveAiConfig(null, noEnv)).toEqual({
      provider: "LOCAL",
      baseUrl: "http://localhost:11434",
      model: null,
      apiKey: null,
      apiKeyProblem: null,
      timeoutMs: 300_000,
    });
  });

  it("uses the DOSSIER_AI_* variables until a provider is saved", () => {
    const config = resolveAiConfig(nothingSaved, {
      DOSSIER_AI_PROVIDER: "anthropic",
      DOSSIER_AI_KEY: "sk-env",
      DOSSIER_AI_TIMEOUT_SECONDS: 90,
    });
    expect(config).toMatchObject({
      provider: "ANTHROPIC",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-5",
      apiKey: "sk-env",
      timeoutMs: 90_000,
    });
  });

  it("knows Mistral's address and a default model", () => {
    expect(resolveAiConfig(nothingSaved, { DOSSIER_AI_PROVIDER: "mistral", DOSSIER_AI_KEY: "mk-env" })).toMatchObject({
      provider: "MISTRAL",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-medium-latest",
      apiKey: "mk-env",
      timeoutMs: 120_000,
    });
  });

  it("finds LM Studio on the Docker host, as patient as a local model", () => {
    expect(resolveAiConfig(nothingSaved, { DOSSIER_AI_PROVIDER: "lmstudio" })).toMatchObject({
      provider: "LMSTUDIO",
      baseUrl: "http://host.docker.internal:1234",
      model: null,
      timeoutMs: 300_000,
    });
  });

  it("prefers what's saved in Settings, with its own key", () => {
    const saved = { provider: "OPENAI" as const, baseUrl: "https://llm.example/v1", model: "gpt-x", apiKeyEnc: encryptApiKey("sk-saved") };
    const config = resolveAiConfig(saved, { DOSSIER_AI_PROVIDER: "local", DOSSIER_AI_URL: "http://ollama:11434", DOSSIER_AI_KEY: "sk-env" });
    expect(config).toMatchObject({ provider: "OPENAI", baseUrl: "https://llm.example/v1", model: "gpt-x", apiKey: "sk-saved", timeoutMs: 120_000 });
  });

  it("lends the env key only to a saved provider of the same kind", () => {
    const saved = { provider: "ANTHROPIC" as const, baseUrl: null, model: null, apiKeyEnc: null };
    expect(resolveAiConfig(saved, { DOSSIER_AI_PROVIDER: "anthropic", DOSSIER_AI_KEY: "sk-env" }).apiKey).toBe("sk-env");
    expect(resolveAiConfig(saved, { DOSSIER_AI_PROVIDER: "openai", DOSSIER_AI_KEY: "sk-env" }).apiKey).toBeNull();
  });

  it("reports a saved key it can't read instead of failing", () => {
    const saved = { provider: "ANTHROPIC" as const, baseUrl: null, model: null, apiKeyEnc: encryptApiKey("sk", "b".repeat(32)) };
    const config = resolveAiConfig(saved, noEnv);
    expect(config).toMatchObject({ apiKey: null, apiKeyProblem: "Your saved API key can't be read. Please enter it again." });
    expect(() => createProvider(config)).toThrow(AiError);
  });
});

describe("createProvider", () => {
  it("picks the implementation for the provider", () => {
    const base = { baseUrl: "http://x", model: "m", apiKey: "k", apiKeyProblem: null, timeoutMs: 1000 };
    expect(createProvider({ ...base, provider: "LOCAL" }).kind).toBe("LOCAL");
    expect(createProvider({ ...base, provider: "OPENAI" }).kind).toBe("OPENAI");
    expect(createProvider({ ...base, provider: "ANTHROPIC" }).kind).toBe("ANTHROPIC");
    expect(createProvider({ ...base, provider: "MISTRAL" }).kind).toBe("MISTRAL");
    expect(createProvider({ ...base, provider: "LMSTUDIO" }).kind).toBe("LMSTUDIO");
  });
});

describe("isAiUsable (#221)", () => {
  const usable = async (settings: Record<string, unknown>) => {
    saved.settings = { provider: null, baseUrl: null, model: null, apiKeyEnc: null, ...settings };
    return isAiUsable();
  };

  it("needs a provider with its model", async () => {
    expect(await usable({})).toBe(false);
    expect(await usable({ provider: "LOCAL" })).toBe(false);
    expect(await usable({ provider: "LOCAL", model: "qwen2.5:7b" })).toBe(true);
    // An OpenAI-compatible server may need no key.
    expect(await usable({ provider: "OPENAI", baseUrl: "http://llm.lan/v1", model: "gpt-x" })).toBe(true);
  });

  it("needs a readable key for the hosted providers that always need one", async () => {
    expect(await usable({ provider: "ANTHROPIC" })).toBe(false);
    expect(await usable({ provider: "ANTHROPIC", apiKeyEnc: encryptApiKey("sk-saved") })).toBe(true);
    expect(await usable({ provider: "MISTRAL", apiKeyEnc: encryptApiKey("sk", "b".repeat(32)) })).toBe(false);
  });
});
