import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptApiKey } from "@/lib/ai/api-key";
import { MockProvider } from "@/lib/ai/providers/mock";
import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";

import { json, stubFetch } from "@/lib/ai/test-http";
import { decryptSecret, JOB_SOURCE_KEY, TYPESAFE_KEY } from "@/lib/secrets";
import { clearJobSearchCache } from "@/lib/job-search/cache";
import { jsearchV2LastPage } from "@/test/job-search-fixtures";

import {
  addDocumentLanguage,
  addConnectorRedirect,
  disconnectApps,
  removeConnectorRedirect,
  listAiModels,
  saveAiProvider,
  saveApiKey,
  saveJobSearchDetails,
  saveJobSource,
  saveJobSourceKey,
  saveScorer,
  saveTypesafeKey,
  setConnector,
  testAiConnection,
  testJev,
  testJobSource,
  updateSettings,
} from "./actions";

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
// The real config and key handling, with a mock model behind them.
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  createProvider: vi.fn(() => provider.current),
}));

const prisma = () => db.client!;
const settings = () => loadSettings();

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  provider.current = new MockProvider({ model: "qwen2.5:3b", models: ["qwen2.5:3b", "llama3.1:8b"] });
});
afterAll(() => prisma().$disconnect());

describe("saveAiProvider", () => {
  it("saves the provider, address and model (SET-1)", async () => {
    expect(await saveAiProvider({ provider: "LOCAL", baseUrl: " http://ollama:11434 ", model: "qwen2.5:3b" })).toEqual({
      ok: true,
      data: { keyState: "none" },
    });
    expect(await settings()).toMatchObject({ provider: "LOCAL", baseUrl: "http://ollama:11434", model: "qwen2.5:3b" });
  });

  it("removes the key when the provider changes, so it never reaches another server", async () => {
    await saveAiProvider({ provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5" });
    await saveApiKey({ provider: "ANTHROPIC", change: { action: "set", value: "sk-ant-secret" } });
    await saveAiProvider({ provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" });
    expect((await settings()).apiKeyEnc).not.toBeNull();
    expect(await saveAiProvider({ provider: "OPENAI", baseUrl: "https://llm.example/v1", model: "" })).toMatchObject({ data: { keyState: "none" } });
    expect(await settings()).toMatchObject({ provider: "OPENAI", model: null, apiKeyEnc: null });
  });
});

describe("saveApiKey", () => {
  it("stores the key encrypted and only says that it's set", async () => {
    await saveAiProvider({ provider: "ANTHROPIC", baseUrl: "", model: "claude-sonnet-5" });
    const result = await saveApiKey({ provider: "ANTHROPIC", change: { action: "set", value: " sk-ant-secret " } });
    expect(result).toEqual({ ok: true, data: { keyState: "set" } });
    expect(JSON.stringify(result)).not.toContain("sk-ant");
    const { apiKeyEnc } = await settings();
    expect(apiKeyEnc).toMatch(/^v1\./);
    expect(decryptApiKey(apiKeyEnc!)).toBe("sk-ant-secret");
  });

  it("saves the provider too when it only came from the environment", async () => {
    await saveApiKey({ provider: "ANTHROPIC", change: { action: "set", value: "sk-ant" } });
    expect(await settings()).toMatchObject({ provider: "ANTHROPIC" });
  });

  it("removes the key only when asked", async () => {
    await saveAiProvider({ provider: "ANTHROPIC", baseUrl: "", model: "" });
    await saveApiKey({ provider: "ANTHROPIC", change: { action: "set", value: "sk-ant" } });
    expect(await saveApiKey({ provider: "ANTHROPIC", change: { action: "clear" } })).toMatchObject({ data: { keyState: "none" } });
    expect((await settings()).apiKeyEnc).toBeNull();
  });

  it("refuses an empty key", async () => {
    expect(await saveApiKey({ provider: "ANTHROPIC", change: { action: "set", value: "  " } })).toMatchObject({ ok: false });
  });
});

describe("testAiConnection and listAiModels", () => {
  it("time a short prompt to the saved provider and list its models (SET-2)", async () => {
    expect(await testAiConnection({})).toEqual({ ok: true, data: { connected: true, model: "qwen2.5:3b", seconds: expect.any(Number) } });
    expect(await listAiModels({})).toEqual({ ok: true, data: { models: ["qwen2.5:3b", "llama3.1:8b"], problem: null } });
  });

  it("report a failure in plain words", async () => {
    provider.current = new MockProvider({ model: null });
    expect(await testAiConnection({})).toEqual({
      ok: true,
      data: { connected: false, message: "Choose a model in Settings → AI provider first." },
    });
  });
});

describe("updateSettings (E10-2, E10-3)", () => {
  it("saves only the settings given", async () => {
    expect(await updateSettings({ creativity: "EXPRESSIVE", strict: false })).toEqual({ ok: true, data: null });
    expect(await settings()).toMatchObject({ creativity: "EXPRESSIVE", strict: false, showDiff: true, paper: "A4" });
  });

  it("goes back to the posting's language with null", async () => {
    await updateSettings({ docLanguage: "Dutch" });
    expect((await settings()).docLanguage).toBe("Dutch");
    await updateSettings({ docLanguage: null });
    expect((await settings()).docLanguage).toBeNull();
  });

  it("refuses settings it doesn't manage, like the API key", async () => {
    expect(await updateSettings({ apiKeyEnc: "x" } as never)).toMatchObject({ ok: false });
    expect(await updateSettings({ paper: "B5" as never })).toMatchObject({ ok: false });
  });
});

describe("addDocumentLanguage (E10-3)", () => {
  it("adds a new language to the list and writes in it", async () => {
    expect(await addDocumentLanguage({ name: " Hebrew " })).toEqual({ ok: true, data: { language: "Hebrew", added: true } });
    expect(await settings()).toMatchObject({ docLanguage: "Hebrew", customLanguages: ["Hebrew"] });
  });

  it("picks a language already in the list, in any case", async () => {
    expect(await addDocumentLanguage({ name: "dutch" })).toEqual({ ok: true, data: { language: "Dutch", added: false } });
    await addDocumentLanguage({ name: "Hebrew" });
    expect(await addDocumentLanguage({ name: "HEBREW" })).toEqual({ ok: true, data: { language: "Hebrew", added: false } });
    expect(await settings()).toMatchObject({ docLanguage: "Hebrew", customLanguages: ["Hebrew"] });
  });
});

describe("job search settings (E14-4)", () => {
  it("saves the source, Off included, and says what the section shows", async () => {
    expect(await saveJobSource({ source: "JSEARCH" })).toEqual({
      ok: true,
      data: {
        source: "JSEARCH",
        jsearch: { host: "openwebninja", keyState: "none" },
        adzuna: { appId: "", keyState: "none" },
        arbeitsagentur: { offered: true, acceptedAt: null },
        freehire: { host: "freehire.me" },
      },
    });
    await saveJobSource({ source: "OFF" });
    expect((await settings()).jobSource).toBe("OFF");
    expect(await saveJobSource({ source: "LINKEDIN" as never })).toMatchObject({ ok: false });
  });

  it("saves the Bundesagentur für Arbeit only with its note accepted (#223)", async () => {
    expect(await saveJobSource({ source: "ARBEITSAGENTUR" })).toEqual({
      ok: false,
      error: "Tick “I understand” under the note about the Bundesagentur für Arbeit first.",
    });
    expect((await settings()).jobSource).toBeNull();
    const saved = await saveJobSource({ source: "ARBEITSAGENTUR", accepted: true });
    expect(saved).toMatchObject({ ok: true, data: { source: "ARBEITSAGENTUR", arbeitsagentur: { offered: true, acceptedAt: expect.any(String) } } });
    const { jobSource, arbeitsagenturAcceptedAt } = await settings();
    expect(jobSource).toBe("ARBEITSAGENTUR");
    expect(Date.parse(arbeitsagenturAcceptedAt!)).toBeGreaterThan(Date.now() - 60_000);
    // Once accepted, switching back needs no second tick.
    await saveJobSource({ source: "JSEARCH" });
    expect(await saveJobSource({ source: "ARBEITSAGENTUR" })).toMatchObject({ ok: true });
  });

  it("stores each source's key encrypted, keeps it when switching, and only says it's set", async () => {
    await saveJobSource({ source: "JSEARCH" });
    const result = await saveJobSourceKey({ source: "JSEARCH", change: { action: "set", value: " ak_secret " } });
    expect(result).toMatchObject({ ok: true, data: { jsearch: { keyState: "set" } } });
    expect(JSON.stringify(result)).not.toContain("ak_secret");
    const stored = (await settings()).jsearchKeyEnc!;
    expect(stored).not.toContain("ak_secret");
    expect(decryptSecret(JOB_SOURCE_KEY, stored)).toBe("ak_secret");

    await saveJobSource({ source: "ADZUNA" });
    await saveJobSearchDetails({ adzunaAppId: " app-1 " });
    await saveJobSourceKey({ source: "ADZUNA", change: { action: "set", value: "adz" } });
    await saveJobSource({ source: "JSEARCH" });
    expect(await settings()).toMatchObject({ jobSource: "JSEARCH", adzunaAppId: "app-1", jsearchKeyEnc: stored });

    await saveJobSourceKey({ source: "JSEARCH", change: { action: "clear" } });
    expect((await settings()).jsearchKeyEnc).toBeNull();
    await saveJobSearchDetails({ adzunaAppId: "" });
    expect((await settings()).adzunaAppId).toBeNull();
  });

  it("saves where the JSearch key is from", async () => {
    expect(await saveJobSearchDetails({ jsearchHost: "rapidapi" })).toMatchObject({ ok: true, data: { jsearch: { host: "rapidapi" } } });
    expect((await settings()).jsearchHost).toBe("rapidapi");
  });

  it("tests the chosen source with its key", async () => {
    clearJobSearchCache();
    expect(await testJobSource({})).toEqual({ ok: true, data: { connected: false, message: "Choose a source first." } });

    await saveJobSource({ source: "JSEARCH" });
    expect(await testJobSource({})).toEqual({
      ok: true,
      data: { connected: false, message: "Add your JSearch key in Settings → Job search first." },
    });

    await saveJobSourceKey({ source: "JSEARCH", change: { action: "set", value: "ak_secret" } });
    const requests = stubFetch(() => json(jsearchV2LastPage));
    expect(await testJobSource({})).toEqual({ ok: true, data: { connected: true, seconds: expect.any(Number) } });
    expect(requests[0].headers.get("x-api-key")).toBe("ak_secret");

    stubFetch(() => json({}, { status: 401 }));
    expect(await testJobSource({})).toEqual({
      ok: true,
      data: { connected: false, message: "JSearch didn't accept your key. Check it in Settings → Job search." },
    });
    vi.unstubAllGlobals();
  });
});

describe("scoring settings (#274)", () => {
  it("saves the scorer, and the TypeSafe key encrypted for it only", async () => {
    expect(await saveScorer({ scorer: "JEV" })).toEqual({ ok: true, data: { scorer: "JEV", keyState: "none" } });
    expect(await saveTypesafeKey({ change: { action: "set", value: " ts_secret " } })).toEqual({ ok: true, data: { scorer: "JEV", keyState: "set" } });
    const saved = await settings();
    expect(saved.scorer).toBe("JEV");
    expect(saved.typesafeKeyEnc).not.toContain("ts_secret");
    expect(decryptSecret(TYPESAFE_KEY, saved.typesafeKeyEnc!)).toBe("ts_secret");
    expect(() => decryptSecret(JOB_SOURCE_KEY, saved.typesafeKeyEnc!)).toThrow();

    expect(await saveTypesafeKey({ change: { action: "clear" } })).toEqual({ ok: true, data: { scorer: "JEV", keyState: "none" } });
    expect((await settings()).typesafeKeyEnc).toBeNull();
    expect(await saveScorer({ scorer: "AI" })).toMatchObject({ ok: true, data: { scorer: "AI" } });
  });

  it("tests Jev with the saved key, with one short question", async () => {
    expect(await testJev({})).toEqual({ ok: true, data: { connected: false, message: "Enter your TypeSafe key in Settings → Scoring first." } });

    await saveTypesafeKey({ change: { action: "set", value: "ts_secret" } });
    const requests = stubFetch(() => json({ model: "jev-1.14.0", answers: { check: { type: "noul", noul: 0.98 } } }));
    expect(await testJev({})).toEqual({ ok: true, data: { connected: true, model: "jev-1.14.0", seconds: expect.any(Number) } });
    expect(requests[0].url.href).toBe("https://api.typesafe.ai/v1/systemone");
    expect(requests[0].headers.get("authorization")).toBe("Bearer ts_secret");
    expect(requests[0].body).toMatchObject({ model: "jev-latest", questions: { check: { type: "noul" } } });

    stubFetch(() => json({}, { status: 401 }));
    expect(await testJev({})).toEqual({ ok: true, data: { connected: false, message: "TypeSafe didn't accept the key. Check it in Settings → Scoring." } });
    vi.unstubAllGlobals();
  });
});

describe("the MCP connector (#221, #281)", () => {
  it("turns on with the time it did, which every token carries, and off again", async () => {
    expect(await disconnectApps({})).toEqual({ ok: false, error: "The MCP connector is off already." });
    expect(await setConnector({ on: true })).toEqual({ ok: true, data: { on: true } });
    const since = (await settings()).connectorEnabledAt;
    expect(Date.parse(since!)).toBeGreaterThan(Date.now() - 60_000);

    // Disconnect all apps: a new time, so every token stops working.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await disconnectApps({})).toMatchObject({ ok: true, toast: "Every app is disconnected. Connect again from an app to use Dossier there." });
    expect((await settings()).connectorEnabledAt).not.toBe(since);

    await setConnector({ on: false });
    expect((await settings()).connectorEnabledAt).toBeNull();
  });

  it("keeps other apps' callback addresses, once each, and refuses one that isn't safe", async () => {
    const n8n = "https://n8n.example/rest/oauth2-credential/callback";
    expect(await addConnectorRedirect({ uri: ` ${n8n} ` })).toEqual({ ok: true, data: { redirects: [n8n] } });
    expect(await addConnectorRedirect({ uri: n8n })).toEqual({ ok: true, data: { redirects: [n8n] } });
    expect(await addConnectorRedirect({ uri: "http://n8n.example/callback" })).toEqual({
      ok: false,
      error: "Use an https:// address, or http:// only for an app on this computer or your own network.",
    });
    expect(await addConnectorRedirect({ uri: "http://localhost:5678/callback" })).toMatchObject({ ok: true, data: { redirects: [n8n, "http://localhost:5678/callback"] } });
    expect((await settings()).connectorRedirects).toEqual([n8n, "http://localhost:5678/callback"]);
    expect(await removeConnectorRedirect({ uri: n8n })).toEqual({ ok: true, data: { redirects: ["http://localhost:5678/callback"] } });
  });
});
