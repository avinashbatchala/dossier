import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptApiKey, encryptApiKey } from "@/lib/ai/api-key";
import type { AiConfig } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { MockProvider } from "@/lib/ai/providers/mock";
import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { connectAi, findLocalAi, saveSetupGuide } from "./actions";

// The actions run against the test database, signed in.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
// The real config and key handling, with a mock model behind them, made for each config.
const ai = vi.hoisted(() => ({ make: undefined as unknown as (config: AiConfig) => unknown, configs: [] as AiConfig[] }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  createProvider: vi.fn((config: AiConfig) => {
    ai.configs.push(config);
    return ai.make(config);
  }),
}));

const prisma = () => db.client!;

beforeEach(async () => {
  await resetDatabase(prisma());
  ai.configs = [];
  ai.make = (config) => new MockProvider({ model: config.model, models: ["gpt-6-luna", "gpt-6.1-terra", "whisper"] });
});
afterAll(() => prisma().$disconnect());

describe("the setup guide's AI step (E21-2)", () => {
  it("saves a hosted provider with its key, picks the guide's model and checks it", async () => {
    const result = await connectAi({ choice: "openai", key: " sk-test " });
    expect(result).toMatchObject({ ok: true, data: { connected: true, model: "gpt-6.1-terra" } });
    const saved = await loadSettings();
    expect(saved).toMatchObject({ provider: "OPENAI", baseUrl: "https://api.openai.com/v1", model: "gpt-6.1-terra" });
    expect(decryptApiKey(saved.apiKeyEnc!, "a".repeat(32))).toBe("sk-test");
    expect(ai.configs.at(-1)).toMatchObject({ apiKey: "sk-test", model: "gpt-6.1-terra" });
  });

  it("checks again with the saved key, and keeps a key waiting for credit", async () => {
    ai.make = () => {
      throw AiError.of("rate-limited", "429");
    };
    expect(await connectAi({ choice: "anthropic", key: "sk-ant-1" })).toMatchObject({ ok: true, data: { connected: false, kind: "rate-limited" } });
    expect((await loadSettings()).apiKeyEnc).not.toBeNull();

    ai.make = (config) => new MockProvider({ model: config.model, models: ["claude-sonnet-5-5"] });
    expect(await connectAi({ choice: "anthropic" })).toMatchObject({ ok: true, data: { connected: true, model: "claude-sonnet-5-5" } });
  });

  it("never sends another provider's key: it asks for one and changes nothing", async () => {
    await connectAi({ choice: "openai", key: "sk-openai" });
    const calls = ai.configs.length;
    expect(await connectAi({ choice: "mistral" })).toMatchObject({ ok: true, data: { connected: false, kind: "auth", message: "Paste your Mistral API key first." } });
    expect(ai.configs.length).toBe(calls);
    expect(await loadSettings()).toMatchObject({ provider: "OPENAI", baseUrl: "https://api.openai.com/v1" });
  });

  it("says when the account has none of the guide's models", async () => {
    ai.make = (config) => new MockProvider({ model: config.model, models: ["something-else"] });
    expect(await connectAi({ choice: "mistral", key: "k" })).toMatchObject({ ok: true, data: { connected: false, kind: "model" } });
  });

  it("finds a local model where it answers, and keeps the model chosen before", async () => {
    ai.make = (config) => {
      if (config.baseUrl !== "http://host.docker.internal:1234") throw AiError.of("unreachable", "ECONNREFUSED");
      return new MockProvider({ model: null, models: ["qwen2.5-7b-instruct", "llama-3.1-8b"] });
    };
    expect(await findLocalAi({ choice: "lmstudio" })).toMatchObject({
      ok: true,
      data: { found: true, baseUrl: "http://host.docker.internal:1234", model: "qwen2.5-7b-instruct" },
    });
    expect(await loadSettings()).toMatchObject({ provider: "LMSTUDIO", baseUrl: "http://host.docker.internal:1234", model: "qwen2.5-7b-instruct" });

    await prisma().setting.update({ where: { key: "model" }, data: { value: "llama-3.1-8b" } });
    expect(await findLocalAi({ choice: "lmstudio" })).toMatchObject({ ok: true, data: { model: "llama-3.1-8b" } });
  });

  it("keeps LM Studio's token only on the server it was saved for", async () => {
    ai.make = (config) => {
      if (config.baseUrl !== "http://localhost:1234") throw AiError.of("unreachable", "ECONNREFUSED");
      return new MockProvider({ model: null, models: ["qwen2.5-7b-instruct"] });
    };
    await prisma().setting.createMany({
      data: [
        { key: "provider", value: "LMSTUDIO" },
        { key: "baseUrl", value: "http://192.168.1.20:1234" },
        { key: "apiKeyEnc", value: encryptApiKey("lm-token") },
      ],
    });
    await findLocalAi({ choice: "lmstudio" });
    expect(await loadSettings()).toMatchObject({ provider: "LMSTUDIO", baseUrl: "http://localhost:1234", apiKeyEnc: null });
  });

  it("says when it can't find one", async () => {
    ai.make = () => {
      throw AiError.of("unreachable", "ECONNREFUSED");
    };
    expect(await findLocalAi({ choice: "ollama" })).toEqual({ ok: true, data: { found: false } });
    expect(ai.configs.map((config) => config.baseUrl)).toEqual(["http://localhost:11434", "http://host.docker.internal:11434", "http://ollama:11434"]);
    expect((await loadSettings()).provider).toBeNull();
  });

  it("remembers the step, and finishes on Done", async () => {
    await saveSetupGuide({ step: "jobs", finished: false });
    expect((await loadSettings()).setupGuide).toEqual({ step: "jobs", finished: false });
  });
});
