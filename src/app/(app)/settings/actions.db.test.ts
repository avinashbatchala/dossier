import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptApiKey } from "@/lib/ai/api-key";
import { MockProvider } from "@/lib/ai/providers/mock";
import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";

import { json, stubFetch } from "@/lib/ai/test-http";
import { DECISIONS_KEY, decryptSecret, JOB_SOURCE_KEY, OPENROUTER_SCORING_KEY, TYPESAFE_KEY } from "@/lib/secrets";
import { clearJobSearchCache } from "@/lib/job-search/cache";
import { jsearchV2LastPage } from "@/test/job-search-fixtures";

import {
  savePortalField,
  savePortalKey,
  setPortalOn,
  testPortal,
  addDocumentLanguage,
  addConnectorRedirect,
  disconnectApps,
  removeConnectorRedirect,
  listAiModels,
  saveAiProvider,
  saveAiTimeout,
  saveApiKey,
  saveScorer,
  saveOpenRouterScoringModel,
  saveScoringKey,
  setConnector,
  testAiConnection,
  testScoringModel,
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
      data: { keyState: "none", keyEnding: null },
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

  it("keeps the key for another path or model on its server, and removes it for another host (public PR 107)", async () => {
    await saveAiProvider({ provider: "OPENAI", baseUrl: "https://openrouter.ai/v1", model: "" });
    await saveApiKey({ provider: "OPENAI", change: { action: "set", value: "sk-or-secret" } });
    expect(await saveAiProvider({ provider: "OPENAI", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-6.1-terra" })).toEqual({
      ok: true,
      data: { keyState: "set", keyEnding: "cret" },
    });
    expect(decryptApiKey((await settings()).apiKeyEnc!)).toBe("sk-or-secret");

    expect(await saveAiProvider({ provider: "OPENAI", baseUrl: "https://api.deepseek.com", model: "" })).toEqual({
      ok: true,
      data: { keyState: "none", keyEnding: null, keyRemoved: true },
    });
    expect((await settings()).apiKeyEnc).toBeNull();
    // Back on the first server, it stays gone.
    expect(await saveAiProvider({ provider: "OPENAI", baseUrl: "https://openrouter.ai/api/v1", model: "" })).toEqual({ ok: true, data: { keyState: "none", keyEnding: null } });
  });
});

describe("saveAiTimeout (public issue 118)", () => {
  it("saves whole seconds within the limits, and empty goes back to the default", async () => {
    expect(await saveAiTimeout({ seconds: 900 })).toEqual({ ok: true, data: { seconds: 900 } });
    expect((await loadSettings()).aiTimeoutSeconds).toBe(900);
    expect((await saveAiTimeout({ seconds: 4 })).ok).toBe(false);
    expect((await saveAiTimeout({ seconds: 3_601 })).ok).toBe(false);
    expect((await saveAiTimeout({ seconds: 12.5 })).ok).toBe(false);
    expect((await loadSettings()).aiTimeoutSeconds).toBe(900);
    await saveAiTimeout({ seconds: null });
    expect((await loadSettings()).aiTimeoutSeconds).toBeNull();
  });
});

describe("saveApiKey", () => {
  it("stores the key encrypted and says only that it's set, with its last four characters (ST4)", async () => {
    await saveAiProvider({ provider: "ANTHROPIC", baseUrl: "", model: "claude-sonnet-5" });
    const result = await saveApiKey({ provider: "ANTHROPIC", change: { action: "set", value: " sk-ant-secret-3f9a " } });
    expect(result).toEqual({ ok: true, data: { keyState: "set", keyEnding: "3f9a" } });
    expect(JSON.stringify(result)).not.toContain("sk-ant");
    const { apiKeyEnc } = await settings();
    expect(apiKeyEnc).toMatch(/^v1\./);
    expect(decryptApiKey(apiKeyEnc!)).toBe("sk-ant-secret-3f9a");
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
    expect(await testAiConnection({})).toEqual({ ok: true, data: { connected: true, model: "qwen2.5:3b", seconds: expect.any(Number), at: expect.any(String) } });
    expect(await listAiModels({})).toEqual({ ok: true, data: { models: ["qwen2.5:3b", "llama3.1:8b"], problem: null } });
  });

  it("keep the result with what it tested (E34-1)", async () => {
    const { data } = (await testAiConnection({})) as { data: { at: string; seconds: number } };
    expect((await settings()).aiTest).toEqual({ at: data.at, provider: "LOCAL", baseUrl: "http://localhost:11434", model: expect.any(String), ok: true, seconds: data.seconds, error: null });
    provider.current = new MockProvider({ model: null });
    await testAiConnection({});
    expect((await settings()).aiTest).toMatchObject({ ok: false, seconds: null, error: "Choose a model in Settings → AI provider first." });
  });

  it("report a failure in plain words", async () => {
    provider.current = new MockProvider({ model: null });
    expect(await testAiConnection({})).toEqual({
      ok: true,
      data: { connected: false, message: "Choose a model in Settings → AI provider first.", at: expect.any(String) },
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

describe("job search settings (E14-4, E22-3)", () => {
  const portal = (data: { portals: { id: string }[] }, id: string) => data.portals.find((entry) => entry.id === id)!;

  it("switches any number of portals on and off, and says what the section shows", async () => {
    const result = await setPortalOn({ portal: "JSEARCH", on: true });
    expect(result).toMatchObject({ ok: true, data: { freehire: { host: "freehire.me" } } });
    expect(result.ok && result.data.portals.map((entry) => [entry.id, entry.on])).toEqual([
      ["JSEARCH", true],
      ["ADZUNA", false],
      ["FREEHIRE", false],
      ["ARBEITSAGENTUR", false],
    ]);
    await setPortalOn({ portal: "FREEHIRE", on: true });
    expect(Object.entries((await settings()).portals!).filter(([, entry]) => entry.on).map(([id]) => id)).toEqual(["JSEARCH", "FREEHIRE"]);
    await setPortalOn({ portal: "JSEARCH", on: false });
    expect((await settings()).portals!.JSEARCH.on).toBe(false);
    expect(await setPortalOn({ portal: "LINKEDIN" as never, on: true })).toMatchObject({ ok: false });
  });

  it("switches the Bundesagentur für Arbeit on only with its note accepted (#223)", async () => {
    expect(await setPortalOn({ portal: "ARBEITSAGENTUR", on: true })).toEqual({
      ok: false,
      error: "Tick “I understand” under the note first.",
    });
    expect((await settings()).portals).toBeNull();
    const saved = await setPortalOn({ portal: "ARBEITSAGENTUR", on: true, accepted: true });
    expect(saved.ok && portal(saved.data, "ARBEITSAGENTUR")).toMatchObject({ on: true, acceptedAt: expect.any(String) });
    expect(Date.parse((await settings()).portals!.ARBEITSAGENTUR.acceptedAt!)).toBeGreaterThan(Date.now() - 60_000);
    // Once accepted, switching it on again needs no second tick.
    await setPortalOn({ portal: "ARBEITSAGENTUR", on: false });
    expect(await setPortalOn({ portal: "ARBEITSAGENTUR", on: true })).toMatchObject({ ok: true });
  });

  it("stores each portal's key encrypted, keeps it when switching, and only says it's set", async () => {
    await setPortalOn({ portal: "JSEARCH", on: true });
    const result = await savePortalKey({ portal: "JSEARCH", field: "key", change: { action: "set", value: " ak_secret " } });
    expect(result.ok && portal(result.data, "JSEARCH")).toMatchObject({ fields: [expect.objectContaining({ name: "key", keyState: "set" }), expect.anything()] });
    expect(JSON.stringify(result)).not.toContain("ak_secret");
    const stored = (await settings()).portalKeysEnc.JSEARCH.key;
    expect(stored).not.toContain("ak_secret");
    expect(decryptSecret(JOB_SOURCE_KEY, stored)).toBe("ak_secret");

    await savePortalField({ portal: "ADZUNA", field: "appId", value: " app-1 " });
    await savePortalKey({ portal: "ADZUNA", field: "key", change: { action: "set", value: "adz" } });
    await setPortalOn({ portal: "JSEARCH", on: false });
    expect(await settings()).toMatchObject({ portals: { ADZUNA: { fields: { appId: "app-1" } } }, portalKeysEnc: { JSEARCH: { key: stored } } });

    await savePortalKey({ portal: "JSEARCH", field: "key", change: { action: "clear" } });
    expect((await settings()).portalKeysEnc.JSEARCH).toEqual({});
    await savePortalField({ portal: "ADZUNA", field: "appId", value: "" });
    expect((await settings()).portals!.ADZUNA.fields).toEqual({});
    expect(await savePortalKey({ portal: "ADZUNA", field: "appId", change: { action: "set", value: "x" } })).toMatchObject({ ok: false });
  });

  it("saves where the JSearch key is from, as one of its options only", async () => {
    const result = await savePortalField({ portal: "JSEARCH", field: "host", value: "rapidapi" });
    expect(result.ok && portal(result.data, "JSEARCH")).toMatchObject({ fields: [expect.anything(), expect.objectContaining({ name: "host", value: "rapidapi" })] });
    expect((await settings()).portals!.JSEARCH.fields.host).toBe("rapidapi");
    expect(await savePortalField({ portal: "JSEARCH", field: "host", value: "elsewhere" })).toEqual({ ok: false, error: "Choose one of the options." });
  });

  it("moves the settings from before E22-3 the first time anything is saved", async () => {
    const { encryptSecret } = await import("@/lib/secrets");
    const { saveSettings } = await import("@/lib/settings-data");
    const key = encryptSecret(JOB_SOURCE_KEY, "az");
    await saveSettings({ jobSource: "ADZUNA", adzunaAppId: "app-9", adzunaKeyEnc: key });
    await setPortalOn({ portal: "FREEHIRE", on: true });
    const after = await settings();
    expect(after).toMatchObject({ jobSource: null, adzunaAppId: null, adzunaKeyEnc: null, portalKeysEnc: { ADZUNA: { key } } });
    expect(after.portals).toMatchObject({ ADZUNA: { on: true, fields: { appId: "app-9" } }, FREEHIRE: { on: true } });
  });

  it("tests a portal with its key", async () => {
    clearJobSearchCache();
    expect(await testPortal({ portal: "JSEARCH" })).toEqual({
      ok: true,
      data: { connected: false, message: "Add your JSearch key in Settings → Job search first." },
    });

    await savePortalKey({ portal: "JSEARCH", field: "key", change: { action: "set", value: "ak_secret" } });
    const requests = stubFetch(() => json(jsearchV2LastPage));
    expect(await testPortal({ portal: "JSEARCH" })).toEqual({ ok: true, data: { connected: true, seconds: expect.any(Number) } });
    expect(requests[0].headers.get("x-api-key")).toBe("ak_secret");

    stubFetch(() => json({}, { status: 401 }));
    expect(await testPortal({ portal: "JSEARCH" })).toEqual({
      ok: true,
      data: { connected: false, message: "JSearch didn't accept your key. Check it in Settings → Job search." },
    });
    vi.unstubAllGlobals();
  });
});

describe("scoring settings (#274, E25-2)", () => {
  it("saves the scoring model, and its key encrypted for it only", async () => {
    const none = { JEV: "none", DECISIONS: "none", OPENROUTER: "none" };
    expect(await saveScorer({ scorer: "JEV" })).toEqual({ ok: true, data: { scorer: "JEV", keys: none, openrouterModel: "openai/gpt-6-luna" } });
    expect(await saveScoringKey({ scorer: "JEV", change: { action: "set", value: " ts_secret " } })).toMatchObject({ ok: true, data: { scorer: "JEV", keys: { ...none, JEV: "set" } } });
    const saved = await settings();
    expect(saved.scorer).toBe("JEV");
    expect(saved.typesafeKeyEnc).not.toContain("ts_secret");
    expect(decryptSecret(TYPESAFE_KEY, saved.typesafeKeyEnc!)).toBe("ts_secret");
    expect(() => decryptSecret(JOB_SOURCE_KEY, saved.typesafeKeyEnc!)).toThrow();

    expect(await saveScoringKey({ scorer: "JEV", change: { action: "clear" } })).toMatchObject({ ok: true, data: { scorer: "JEV", keys: none } });
    expect((await settings()).typesafeKeyEnc).toBeNull();
    // The AI model has no key of its own.
    expect(await saveScoringKey({ scorer: "AI", change: { action: "set", value: "x" } })).toEqual({ ok: false, error: "Your AI model needs no key." });
    expect(await saveScorer({ scorer: "AI" })).toMatchObject({ ok: true, data: { scorer: "AI" } });
  });

  it("saves OpenAI Decisions' and OpenRouter's keys, each for its own model, and OpenRouter's model (E25-3, E25-4)", async () => {
    expect(await saveScoringKey({ scorer: "DECISIONS", change: { action: "set", value: "sk-decisions" } })).toMatchObject({ ok: true, data: { keys: { DECISIONS: "set", OPENROUTER: "none" } } });
    expect(await saveScoringKey({ scorer: "OPENROUTER", change: { action: "set", value: "sk-or" } })).toMatchObject({ ok: true, data: { keys: { DECISIONS: "set", OPENROUTER: "set" } } });
    const saved = await settings();
    expect(decryptSecret(DECISIONS_KEY, saved.decisionsKeyEnc!)).toBe("sk-decisions");
    expect(decryptSecret(OPENROUTER_SCORING_KEY, saved.openrouterScoringKeyEnc!)).toBe("sk-or");
    expect(() => decryptSecret(TYPESAFE_KEY, saved.decisionsKeyEnc!)).toThrow();

    expect(await saveOpenRouterScoringModel({ model: " mistralai/mistral-small-2603 " })).toMatchObject({ ok: true, data: { openrouterModel: "mistralai/mistral-small-2603" } });
    expect(await saveOpenRouterScoringModel({ model: "" })).toMatchObject({ ok: true, data: { openrouterModel: "openai/gpt-6-luna" } });
  });

  it("tests OpenAI Decisions with one short question", async () => {
    await saveScoringKey({ scorer: "DECISIONS", change: { action: "set", value: "sk-decisions" } });
    const requests = stubFetch(() => json({ model: "gpt-6-luna", answers: [{ type: "predicate", name: "check", probability: 0.97 }], usage: { input_tokens: 40, output_tokens: 0 } }));
    expect(await testScoringModel({ scorer: "DECISIONS" })).toEqual({ ok: true, data: { connected: true, model: "gpt-6-luna", seconds: expect.any(Number) } });
    expect(requests[0].url.href).toBe("https://api.openai.com/v1/decisions");
    expect(requests[0].headers.get("authorization")).toBe("Bearer sk-decisions");
    vi.unstubAllGlobals();
  });

  it("tests Jev with the saved key, with one short question", async () => {
    expect(await testScoringModel({ scorer: "JEV" })).toEqual({ ok: true, data: { connected: false, message: "Enter your TypeSafe key in Settings → Scoring first." } });

    await saveScoringKey({ scorer: "JEV", change: { action: "set", value: "ts_secret" } });
    const requests = stubFetch(() => json({ model: "jev-1.14.0", answers: { check: { type: "noul", noul: 0.98 } } }));
    expect(await testScoringModel({ scorer: "JEV" })).toEqual({ ok: true, data: { connected: true, model: "jev-1.14.0", seconds: expect.any(Number) } });
    expect(requests[0].url.href).toBe("https://api.typesafe.ai/v1/systemone");
    expect(requests[0].headers.get("authorization")).toBe("Bearer ts_secret");
    expect(requests[0].body).toMatchObject({ model: "jev-latest", questions: { check: { type: "noul" } } });

    stubFetch(() => json({}, { status: 401 }));
    expect(await testScoringModel({ scorer: "JEV" })).toEqual({ ok: true, data: { connected: false, message: "TypeSafe didn't accept the key. Check it in Settings → Scoring." } });
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
