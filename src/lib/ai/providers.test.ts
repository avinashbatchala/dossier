import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { UsageEntry } from "@/lib/usage";

import { AiError } from "./errors";
import { AnthropicProvider, ANTHROPIC_FALLBACK_MODELS } from "./providers/anthropic";
import { LMSTUDIO_UNREACHABLE, LmStudioProvider } from "./providers/lmstudio";
import { LocalProvider } from "./providers/local";
import { MISTRAL_FALLBACK_MODELS, MistralProvider } from "./providers/mistral";
import { MockProvider } from "./providers/mock";
import { OllamaProvider } from "./providers/ollama";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { hang, json, refused, stubFetch } from "./test-http";

afterEach(() => vi.unstubAllGlobals());

const ask = { task: "connection-check" as const, system: "Be brief.", messages: [{ role: "user" as const, content: "Hi" }] };
const Person = z.object({ name: z.string(), years: z.number() });

/** The AiError a promise rejects with. */
async function failure(promise: Promise<unknown>): Promise<AiError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

const ollamaChat = (content: string) => json({ model: "qwen2.5:3b", message: { role: "assistant", content }, done: true });
const openaiChat = (content: string) =>
  json({ id: "c1", object: "chat.completion", created: 0, model: "gpt", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
const thinkingChat = (content: string, finish_reason = "stop") =>
  json({
    id: "c1",
    object: "chat.completion",
    created: 0,
    model: "thinker",
    choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: "Thinking it through…" }, finish_reason }],
  });
const mistralChat = (content: unknown, finish_reason = "stop") =>
  json({ id: "c1", object: "chat.completion", created: 0, model: "mistral-medium-latest", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason }] });
const anthropicMessage = (text: string, stop_reason = "end_turn") =>
  json({ id: "m1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text }], stop_reason, usage: { input_tokens: 1, output_tokens: 1 } });
const anthropicModel = (id: string, effort: boolean) => {
  const level = { supported: effort };
  return json({
    id,
    type: "model",
    display_name: id,
    created_at: "2026-01-01T00:00:00Z",
    capabilities: { effort: { supported: effort, low: level, medium: level, high: level, max: level, xhigh: null } },
  });
};

describe("OllamaProvider", () => {
  it("chats through /api/chat with the system prompt first, the creativity as temperature and a roomy context", async () => {
    const requests = stubFetch(() => ollamaChat("Hello!"));
    const provider = new OllamaProvider("http://ollama:11434", "qwen2.5:3b", 60_000);
    expect(await provider.complete({ ...ask, creativity: "FAITHFUL" })).toBe("Hello!");
    expect(requests[0].url.href).toBe("http://ollama:11434/api/chat");
    expect(requests[0].body).toMatchObject({
      model: "qwen2.5:3b",
      stream: false,
      messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }],
      options: { temperature: 0.2, num_ctx: 16_384, num_predict: 4096 },
    });
  });

  it("never lets the model think, and puts the schema in the instructions for JSON", async () => {
    const requests = stubFetch(() => ollamaChat('{"name":"Jane","years":9}'));
    const provider = new OllamaProvider("http://ollama:11434", "qwen3.5:4b", 60_000);
    await provider.complete({ ...ask, schema: Person });
    expect(requests[0].body).toMatchObject({ think: false, format: { type: "object" } });
    expect((requests[0].body as { messages: { content: string }[] }).messages[0].content).toMatch(/^Be brief\.\n\nReply with only a JSON object[\s\S]*"years"/);
  });

  it("asks for JSON with the schema and validates the answer", async () => {
    const requests = stubFetch(() => ollamaChat('{"name":"Jane","years":9}'));
    const provider = new OllamaProvider("http://ollama:11434", "qwen2.5:3b", 60_000);
    expect(await provider.complete({ ...ask, schema: Person })).toEqual({ name: "Jane", years: 9 });
    expect(requests[0].body).toMatchObject({ format: { type: "object", required: ["name", "years"] } });
  });

  it("lists installed models", async () => {
    stubFetch(() => json({ models: [{ name: "qwen2.5:3b" }, { name: "llama3.1:8b" }] }));
    expect(await new OllamaProvider("http://ollama:11434", null, 60_000).listModels()).toEqual(["llama3.1:8b", "qwen2.5:3b"]);
  });

  it("says which model is missing", async () => {
    stubFetch(() => json({ error: "model 'nope' not found, try pulling it first" }, { status: 404 }));
    const error = await failure(new OllamaProvider("http://ollama:11434", "nope", 60_000).complete(ask));
    expect(error).toMatchObject({ kind: "model", message: expect.stringContaining("“nope”") });
  });
});

describe("OpenAICompatibleProvider", () => {
  it("chats through /chat/completions with a key and temperature", async () => {
    const requests = stubFetch(() => openaiChat("Hello!"));
    const provider = new OpenAICompatibleProvider("OPENAI", "https://api.example.com/v1", "sk-test", "gpt-x", 60_000);
    expect(await provider.complete({ ...ask, creativity: "EXPRESSIVE" })).toBe("Hello!");
    expect(requests[0].url.href).toBe("https://api.example.com/v1/chat/completions");
    expect(requests[0].headers.get("authorization")).toBe("Bearer sk-test");
    expect(requests[0].body).toMatchObject({ model: "gpt-x", temperature: 0.9, max_tokens: 4096 });
    expect(requests[0].body).not.toHaveProperty("thinking");
  });

  it("disables DeepSeek thinking, which counts towards max_tokens, and leaves room for the answer", async () => {
    const requests = stubFetch(() => openaiChat("Hello!"));
    const provider = new OpenAICompatibleProvider("OPENAI", "https://api.deepseek.com", "sk-test", "deepseek-flash", 60_000);
    expect(await provider.complete(ask)).toBe("Hello!");
    expect(requests[0].url.href).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[0].body).toMatchObject({
      model: "deepseek-flash",
      max_tokens: 8192,
      thinking: { type: "disabled" },
    });
  });

  it("asks for a strict JSON schema", async () => {
    const requests = stubFetch(() => openaiChat('{"name":"Jane","years":9}'));
    const provider = new OpenAICompatibleProvider("OPENAI", "https://api.example.com/v1", "sk-test", "gpt-x", 60_000);
    expect(await provider.complete({ ...ask, schema: Person, schemaName: "person" })).toEqual({ name: "Jane", years: 9 });
    expect(requests[0].body).toMatchObject({ response_format: { type: "json_schema", json_schema: { name: "person", strict: true } } });
  });

  it("drops what a model refuses, once, and remembers it", async () => {
    const requests = stubFetch(({ body }) => {
      const sent = body as Record<string, unknown>;
      if ("temperature" in sent) return json({ error: { message: "Unsupported parameter: 'temperature'" } }, { status: 400 });
      if ("max_tokens" in sent) return json({ error: { message: "Use 'max_completion_tokens' instead of 'max_tokens'." } }, { status: 400 });
      return openaiChat("Hello!");
    });
    const provider = new OpenAICompatibleProvider("OPENAI", "https://quirky.example/v1", "sk", "reasoner", 60_000);
    expect(await provider.complete({ ...ask, creativity: "BALANCED" })).toBe("Hello!");
    expect(await provider.complete({ ...ask, creativity: "BALANCED" })).toBe("Hello!");
    const last = requests.at(-1)!.body;
    expect(last).not.toHaveProperty("temperature");
    expect(last).toMatchObject({ max_completion_tokens: 4096 });
    // Two refusals the first time, none the second.
    expect(requests).toHaveLength(4);
  });

  it("tells DeepSeek's API not to think, by its host, and leaves other servers as they were (#189)", async () => {
    const requests = stubFetch(() => openaiChat('{"name":"Jane","years":9}'));
    for (const url of ["https://api.deepseek.com", "https://api.deepseek.com/v1", "https://example.com/v1", "https://notdeepseek.com/v1"]) {
      const provider = new OpenAICompatibleProvider("OPENAI", url, "sk", "deepseek-flash", 60_000);
      expect(await provider.complete({ ...ask, schema: Person, creativity: "FAITHFUL" })).toEqual({ name: "Jane", years: 9 });
    }
    expect(requests.map((request) => (request.body as Record<string, unknown>).thinking)).toEqual([
      { type: "disabled" },
      { type: "disabled" },
      undefined,
      undefined,
    ]);
    // Without thinking, the creativity counts again; this fork keeps a larger budget for longer documents.
    expect(requests[0].body).toMatchObject({ temperature: 0.2, max_tokens: 8192, response_format: { type: "json_schema" } });
  });

  it("asks OpenRouter to skip companies that keep or train on prompts (E21-7)", async () => {
    const requests = stubFetch(() => openaiChat('{"name":"Jane","years":9}'));
    for (const url of ["https://openrouter.ai/api/v1", "https://example.com/v1"]) {
      await new OpenAICompatibleProvider("OPENAI", url, "sk", "openai/gpt-6.1-terra", 60_000).complete({ ...ask, schema: Person });
    }
    expect(requests.map((request) => (request.body as Record<string, unknown>).provider)).toEqual([{ data_collection: "deny" }, undefined]);
  });

  it("puts the schema in the prompt for Ollama's cloud, which takes response_format without holding answers to it (#276)", async () => {
    // As Ollama's cloud does: whatever response_format says, the model answers in a shape of its own.
    const requests = stubFetch(({ body }) => {
      const { messages } = body as { messages: { content: string }[] };
      return openaiChat(messages[0].content.includes("matches this JSON schema") ? '{"name":"Jane","years":9}' : '{"person":"Jane","experience":"9 years"}');
    });
    for (const [url, model] of [
      ["https://ollama.com/v1", "gpt-oss:120b"],
      ["http://ollama:11434/v1", "gpt-oss:120b-cloud"],
    ]) {
      const provider = new OpenAICompatibleProvider("OPENAI", url, "sk", model, 60_000);
      expect(await provider.complete({ ...ask, schema: Person, schemaName: "person" })).toEqual({ name: "Jane", years: 9 });
    }
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(request.body).not.toHaveProperty("response_format");

    // Elsewhere the schema stays in response_format, out of the prompt.
    const provider = new OpenAICompatibleProvider("OPENAI", "http://ollama:11434/v1", null, "qwen2.5:3b", 60_000);
    await provider.complete({ ...ask, schema: Person, schemaName: "person" }).catch(() => undefined);
    expect(requests[2].body).toMatchObject({ response_format: { type: "json_schema" } });
    expect((requests[2].body as { messages: { content: string }[] }).messages[0].content).toBe("Be brief.");
  });

  it("maps HTTP failures to plain words, never the provider's message", async () => {
    const cases: [number, string][] = [
      [401, "auth"],
      [404, "model"],
      [429, "rate-limited"],
      [500, "provider"],
    ];
    for (const [status, kind] of cases) {
      stubFetch(() => json({ error: { message: "Incorrect API key provided: sk-abc***xyz" } }, { status }));
      const provider = new OpenAICompatibleProvider("OPENAI", "https://api.example.com/v1", "sk-abc-xyz", "gpt-x", 60_000);
      const error = await failure(provider.complete(ask));
      expect(error.kind, String(status)).toBe(kind);
      expect(error.message).not.toContain("sk-");
      expect(error.detail).not.toContain("sk-");
    }
  });

  it("recognises input that doesn't fit the context", async () => {
    stubFetch(() => json({ error: { message: "This model's maximum context length is 8192 tokens." } }, { status: 400 }));
    const provider = new OpenAICompatibleProvider("OPENAI", "https://api.example.com/v1", "sk", "gpt-x", 60_000);
    expect(await failure(provider.complete(ask))).toMatchObject({ kind: "too-long" });
  });

  it("lists models", async () => {
    stubFetch(() => json({ object: "list", data: [{ id: "b-model", object: "model" }, { id: "a-model", object: "model" }] }));
    const provider = new OpenAICompatibleProvider("OPENAI", "https://api.example.com/v1", "sk", null, 60_000);
    expect(await provider.listModels()).toEqual(["a-model", "b-model"]);
  });

  it("reaches known servers at their API's address with their headers, and sends no made-up key", async () => {
    const requests = stubFetch(({ url }) =>
      url.pathname.endsWith("/models") ? json({ object: "list", data: [{ id: "glm-5.3-flash", object: "model" }] }) : openaiChat("Hello!"),
    );
    const go = new OpenAICompatibleProvider("OPENAI", "https://opencode.ai/inference/go/openai/v1", null, "glm-5.3-flash", 60_000);
    expect(await go.listModels()).toEqual(["glm-5.3-flash"]);
    expect(requests[0].url.href).toBe("https://opencode.ai/inference/go/v1/models");
    expect(requests[0].headers.get("authorization")).toBeNull();
    expect(requests[0].headers.get("x-opencode-session")).toMatch(/^ses_[0-9a-f-]{36}$/);
    expect(requests[0].headers.get("user-agent")).toMatch(/^Dossier\/\d/);

    const router = new OpenAICompatibleProvider("OPENAI", "https://openrouter.ai/v1", "sk-or", "openrouter/auto", 60_000);
    expect(await router.complete(ask)).toBe("Hello!");
    expect(requests[1].url.href).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(requests[1].headers.get("authorization")).toBe("Bearer sk-or");
    expect(requests[1].headers.has("x-opencode-session")).toBe(false);
  });

  it("leaves room for thinking once it left the answer none, and from then on", async () => {
    const requests = stubFetch(({ body }) =>
      (body as { max_tokens: number }).max_tokens > 4096 ? thinkingChat('{"name":"Jane","years":9}') : thinkingChat("", "length"),
    );
    const provider = new OpenAICompatibleProvider("OPENAI", "https://thinker.example/v1", "sk", "glm-5", 60_000);
    expect(await provider.complete({ ...ask, schema: Person })).toEqual({ name: "Jane", years: 9 });
    expect(await provider.complete({ ...ask, schema: Person })).toEqual({ name: "Jane", years: 9 });
    expect(requests.map((request) => (request.body as { max_tokens: number }).max_tokens)).toEqual([4096, 4096 + 12_000, 4096 + 12_000]);
  });

  it("leaves room for thinking when the server refuses an answer that didn't fit, as gpt-6-luna does (public PR 51)", async () => {
    const requests = stubFetch(({ body }) => {
      const sent = body as { max_tokens?: number; max_completion_tokens: number };
      if (sent.max_tokens !== undefined) {
        return json({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }, { status: 400 });
      }
      return sent.max_completion_tokens > 16
        ? openaiChat("OK")
        : json({ error: { message: "Could not finish the message because max_tokens or model output limit was reached. Please try again with higher max_tokens." } }, { status: 400 });
    });
    const provider = new OpenAICompatibleProvider("OPENAI", "https://no-room.example/v1", "sk", "gpt-6-luna", 60_000);
    await expect(provider.test()).resolves.toMatchObject({ model: "gpt-6-luna" });
    await provider.test();
    expect(requests.map(({ body }) => body)).toMatchObject([{ max_tokens: 16 }, { max_completion_tokens: 16 }, { max_completion_tokens: 16 + 12_000 }, { max_completion_tokens: 16 + 12_000 }]);
  });

  it("says the answer was cut off when it still doesn't fit", async () => {
    const requests = stubFetch(() =>
      json({ error: { message: "Could not finish the message because max_tokens or model output limit was reached. Please try again with higher max_tokens." } }, { status: 400 }),
    );
    const provider = new OpenAICompatibleProvider("OPENAI", "https://never-room.example/v1", "sk", "gpt-6-luna", 60_000);
    expect(await failure(provider.complete(ask))).toMatchObject({ kind: "cut-off" });
    expect(requests.map(({ body }) => (body as { max_tokens: number }).max_tokens)).toEqual([4096, 4096 + 12_000]);
  });

  it("keeps the usual budget for a model whose thinking leaves room for the answer", async () => {
    const requests = stubFetch(() => thinkingChat('{"name":"Jane","years":9}'));
    const provider = new OpenAICompatibleProvider("OPENAI", "https://brief-thinker.example/v1", "sk", "glm-5", 60_000);
    await provider.complete({ ...ask, schema: Person });
    await provider.complete({ ...ask, schema: Person });
    expect(requests.map((request) => (request.body as { max_tokens: number }).max_tokens)).toEqual([4096, 4096]);
  });
});

describe("AnthropicProvider", () => {
  it("sends no temperature, since current models refuse one, and leaves room for thinking", async () => {
    const requests = stubFetch(() => anthropicMessage("Hello!"));
    const provider = new AnthropicProvider("https://api.anthropic.com", "sk-ant", "claude-sonnet-5", 60_000);
    expect(await provider.complete({ ...ask, creativity: "EXPRESSIVE" })).toBe("Hello!");
    expect(requests[0].url.href).toBe("https://api.anthropic.com/v1/messages");
    expect(requests[0].headers.get("x-api-key")).toBe("sk-ant");
    expect(requests[0].headers.get("authorization")).toBeNull();
    expect(requests[0].headers.get("anthropic-version")).toBe("2026-10-21");
    expect(requests[0].body).toMatchObject({ model: "claude-sonnet-5", system: "Be brief.", max_tokens: 4096 + 12_000 });
    expect(requests[0].body).not.toHaveProperty("temperature");
    expect(requests[0].body).not.toHaveProperty("output_config");
  });

  it("asks for an effort where the model takes one, looking that up once", async () => {
    const baseUrl = `https://claude-${Math.random()}.example`;
    const requests = stubFetch(({ url }) =>
      url.pathname === "/v1/models/claude-sonnet-5" ? anthropicModel("claude-sonnet-5", true) : anthropicMessage('{"name":"Jane","years":9}'),
    );
    const provider = new AnthropicProvider(baseUrl, "sk-ant", "claude-sonnet-5", 60_000);
    expect(await provider.complete({ ...ask, schema: Person, effort: "low" })).toEqual({ name: "Jane", years: 9 });
    await provider.complete({ ...ask, schema: Person, effort: "low" });
    const messages = requests.filter((request) => request.url.pathname === "/v1/messages");
    expect(messages.map((request) => request.body)).toMatchObject([
      { output_config: { effort: "low", format: { type: "json_schema" } } },
      { output_config: { effort: "low" } },
    ]);
    expect(requests).toHaveLength(3);
  });

  it("leaves the effort out for models that don't take one, or when that can't be looked up", async () => {
    const baseUrl = `https://claude-${Math.random()}.example`;
    const requests = stubFetch(({ url }) =>
      url.pathname === "/v1/models/claude-haiku-4-5"
        ? anthropicModel("claude-haiku-4-5", false)
        : url.pathname.startsWith("/v1/models/")
          ? json({ error: { type: "api_error", message: "boom" } }, { status: 500 })
          : anthropicMessage("Hello!"),
    );
    expect(await new AnthropicProvider(baseUrl, "sk-ant", "claude-haiku-4-5", 60_000).complete({ ...ask, effort: "low" })).toBe("Hello!");
    expect(await new AnthropicProvider(baseUrl, "sk-ant", "claude-sonnet-5", 60_000).complete({ ...ask, effort: "low" })).toBe("Hello!");
    const messages = requests.filter((request) => request.url.pathname === "/v1/messages");
    expect(messages).toHaveLength(2);
    for (const request of messages) expect(request.body).not.toHaveProperty("output_config");
  });

  it("asks for structured output through output_config", async () => {
    const requests = stubFetch(() => anthropicMessage('{"name":"Jane","years":9}'));
    const provider = new AnthropicProvider("https://api.anthropic.com", "sk-ant", "claude-sonnet-5", 60_000);
    expect(await provider.complete({ ...ask, schema: Person })).toEqual({ name: "Jane", years: 9 });
    expect(requests[0].body).toMatchObject({ output_config: { format: { type: "json_schema" } } });
  });

  describe("a schema the API refuses as too complex (#230)", () => {
    const badRequest = (message: string) => json({ type: "error", error: { type: "invalid_request_error", message } }, { status: 400 });
    const format = (body: unknown) => (body as { output_config?: { format?: unknown } }).output_config?.format;

    it.each([
      "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.",
      "Schemas contains too many parameters with union types (32 parameters with type arrays or anyOf). This causes exponential compilation cost. Reduce the number of nullable or union-typed parameters (limit: 16 parameters with unions).",
      "Schema is too complex for compilation.",
    ])("goes in the prompt instead, with the effort still sent, and is remembered: %s", async (refusal) => {
      const baseUrl = `https://claude-${Math.random()}.example`;
      const requests = stubFetch(({ url, body }) =>
        url.pathname === "/v1/models/claude-sonnet-5"
          ? anthropicModel("claude-sonnet-5", true)
          : format(body)
            ? badRequest(refusal)
            : anthropicMessage('```json\n{"name":"Jane","years":9}\n```'),
      );
      const provider = new AnthropicProvider(baseUrl, "sk-ant", "claude-sonnet-5", 60_000);
      expect(await provider.complete({ ...ask, schema: Person, schemaName: "person", effort: "low" })).toEqual({ name: "Jane", years: 9 });
      expect(await provider.complete({ ...ask, schema: Person, schemaName: "person", effort: "low" })).toEqual({ name: "Jane", years: 9 });
      const messages = requests.filter((request) => request.url.pathname === "/v1/messages").map((request) => request.body);
      expect(messages).toMatchObject([
        { output_config: { effort: "low", format: { type: "json_schema" } } },
        { output_config: { effort: "low" }, system: expect.stringContaining("matches this JSON schema") },
        { output_config: { effort: "low" }, system: expect.stringContaining("matches this JSON schema") },
      ]);
      expect(format(messages[1])).toBeUndefined();
      expect(format(messages[2])).toBeUndefined();
    });

    it("goes in the prompt only for that schema; others on the same model keep structured output", async () => {
      const baseUrl = `https://claude-${Math.random()}.example`;
      const City = z.object({ city: z.string() });
      // Person's schema is refused; City's isn't.
      const requests = stubFetch(({ body }) =>
        JSON.stringify(format(body) ?? {}).includes('"years"')
          ? badRequest("The compiled grammar is too large, which would cause performance issues.")
          : anthropicMessage(format(body) ? '{"city":"Utrecht"}' : '{"name":"Jane","years":9}'),
      );
      const provider = new AnthropicProvider(baseUrl, "sk-ant", "claude-sonnet-5", 60_000);
      expect(await provider.complete({ ...ask, schema: Person, schemaName: "person" })).toEqual({ name: "Jane", years: 9 });
      expect(await provider.complete({ ...ask, schema: City, schemaName: "city" })).toEqual({ city: "Utrecht" });
      expect(requests).toHaveLength(3);
      expect(requests[2].body).toMatchObject({ system: "Be brief.", output_config: { format: { type: "json_schema" } } });
    });

    it("sends any other 400 once and says the provider had a problem", async () => {
      const requests = stubFetch(() => badRequest('messages: roles must alternate between "user" and "assistant"'));
      const provider = new AnthropicProvider(`https://claude-${Math.random()}.example`, "sk-ant", "claude-sonnet-5", 60_000);
      expect(await failure(provider.complete({ ...ask, schema: Person, schemaName: "person" }))).toMatchObject({ kind: "provider" });
      expect(requests).toHaveLength(1);
    });
  });

  it("says when the model declines", async () => {
    stubFetch(() => anthropicMessage("", "refusal"));
    const provider = new AnthropicProvider("https://api.anthropic.com", "sk-ant", "claude-sonnet-5", 60_000);
    expect((await failure(provider.complete(ask))).message).toMatch(/declined/);
  });

  it("needs a key to answer, but still offers models without one", async () => {
    const provider = new AnthropicProvider("https://api.anthropic.com", null, "claude-sonnet-5", 60_000);
    expect(await failure(provider.complete(ask))).toMatchObject({ kind: "config" });
    expect(await provider.listModels()).toEqual(ANTHROPIC_FALLBACK_MODELS);
  });

  it("lists models, falling back to known ones when that fails", async () => {
    stubFetch(() => json({ data: [{ id: "claude-sonnet-5", type: "model" }], has_more: false }));
    expect(await new AnthropicProvider("https://api.anthropic.com", "sk-ant", null, 60_000).listModels()).toEqual(["claude-sonnet-5"]);
    stubFetch(() => json({ error: { type: "api_error", message: "boom" } }, { status: 500 }));
    expect(await new AnthropicProvider("https://api.anthropic.com", "sk-ant", null, 60_000).listModels()).toEqual(ANTHROPIC_FALLBACK_MODELS);
  });
});

describe("MistralProvider", () => {
  // Each test its own address: what a model refuses is remembered per address and model.
  const mistral = (baseUrl: string, key: string | null = "mk-test") => new MistralProvider(baseUrl, key, "mistral-medium-latest", 60_000);

  it("chats through /chat/completions with the key, a temperature and a strict JSON schema", async () => {
    const requests = stubFetch(() => mistralChat('{"name":"Jane","years":9}'));
    const result = await mistral("https://api.mistral.ai/v1").complete({ ...ask, creativity: "FAITHFUL", schema: Person, schemaName: "person" });
    expect(result).toEqual({ name: "Jane", years: 9 });
    expect(requests[0].url.href).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(requests[0].headers.get("authorization")).toBe("Bearer mk-test");
    expect(requests[0].body).toMatchObject({
      model: "mistral-medium-latest",
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: "json_schema", json_schema: { name: "person", strict: true } },
    });
    expect(requests[0].body).not.toHaveProperty("reasoning_effort");
  });

  it("reads an answer that comes in chunks, without the thinking", async () => {
    stubFetch(() =>
      mistralChat([
        { type: "thinking", thinking: [{ type: "text", text: "A name and a number of years." }] },
        { type: "text", text: '{"name":"Jane",' },
        { type: "text", text: '"years":9}' },
      ]),
    );
    expect(await mistral("https://chunks.mistral.test/v1").complete({ ...ask, schema: Person })).toEqual({ name: "Jane", years: 9 });
  });

  it("asks reading tasks not to think, and stops asking a model that refuses", async () => {
    const requests = stubFetch(() => mistralChat("Hello!"));
    await mistral("https://effort.mistral.test/v1").complete({ ...ask, effort: "low" });
    expect(requests[0].body).toMatchObject({ reasoning_effort: "none" });

    const refused = stubFetch(({ body }) =>
      "reasoning_effort" in (body as object)
        ? json({ object: "error", message: "reasoning_effort is not supported by this model", type: "invalid_request_error" }, { status: 422 })
        : mistralChat("Hello!"),
    );
    const provider = mistral("https://no-effort.mistral.test/v1");
    expect(await provider.complete({ ...ask, effort: "low" })).toBe("Hello!");
    expect(await provider.complete({ ...ask, effort: "low" })).toBe("Hello!");
    expect(refused.map((request) => "reasoning_effort" in (request.body as object))).toEqual([true, false, false]);
  });

  it("counts running out of context as cut off", async () => {
    stubFetch(() => mistralChat('{"name":"Ja', "model_length"));
    expect(await failure(mistral("https://cut.mistral.test/v1").complete({ ...ask, schema: Person }))).toMatchObject({ kind: "cut-off" });
  });

  it("needs a key to answer, but still offers models without one", async () => {
    const requests = stubFetch(() => mistralChat("Hello!"));
    const provider = mistral("https://api.mistral.ai/v1", null);
    expect(await failure(provider.complete(ask))).toMatchObject({ kind: "config", message: expect.stringContaining("Mistral API key") });
    expect(await provider.listModels()).toEqual(MISTRAL_FALLBACK_MODELS);
    expect(requests).toHaveLength(0);
  });

  it("says when Mistral allows the key no requests, or the plan lacks the model", async () => {
    stubFetch(() =>
      json(
        { object: "error", message: "Rate limit exceeded", type: "rate_limited", code: "1300" },
        { status: 429, headers: { "x-ratelimit-limit-req-minute": "0", "x-ratelimit-remaining-req-minute": "0" } },
      ),
    );
    expect(await failure(mistral("https://api.mistral.ai/v1").complete(ask))).toMatchObject({
      kind: "config",
      message: expect.stringContaining("0 requests a minute"),
    });

    stubFetch(() => json({ object: "error", message: "Rate limit exceeded", type: "rate_limited" }, { status: 429, headers: { "x-ratelimit-limit-req-minute": "2" } }));
    expect(await failure(mistral("https://api.mistral.ai/v1").complete(ask))).toMatchObject({ kind: "rate-limited" });

    stubFetch(() => json({ object: "error", message: "This model is not available in your subscription tier", type: "invalid_request_error" }, { status: 403 }));
    expect(await failure(mistral("https://api.mistral.ai/v1").complete(ask))).toMatchObject({
      kind: "model",
      message: "Your Mistral plan doesn't include “mistral-medium-latest”. Pick another model in Settings → AI provider.",
    });
  });

  it("lists one name per chat model, without embedding, OCR or retired ones", async () => {
    const card = (id: string, aliases: string[] = [], extra: object = {}) => ({ id, object: "model", capabilities: { completion_chat: true }, aliases, ...extra });
    const medium = ["mistral-medium-latest", "mistral-medium-2604", "mistral-vibe-cli-latest", "magistral-medium-latest"];
    const others = (id: string, group: string[]) => group.filter((name) => name !== id);
    stubFetch(() =>
      json({
        object: "list",
        data: [
          card("codestral-2508", ["codestral-latest", "mistral-code-latest"]),
          card("codestral-latest", ["codestral-2508", "mistral-code-latest"]),
          ...medium.map((id) => card(id, others(id, medium))),
          card("labs-leanstral-1-5-1", ["labs-leanstral-1-5"]),
          card("mistral-embed", ["mistral-embed-2312"], { capabilities: { completion_chat: false } }),
          card("mistral-ocr-latest", [], { capabilities: { completion_chat: false } }),
          card("open-mistral-7b", [], { archived: true }),
          card("mistral-large-2407", [], { deprecation: "2025-03-30T12:00:00Z" }),
          card("mistral-small-2603", ["mistral-small-latest"], { deprecation: "2099-01-01T00:00:00Z" }),
        ],
      }),
    );
    expect(await mistral("https://api.mistral.ai/v1").listModels()).toEqual([
      "codestral-latest",
      "labs-leanstral-1-5",
      "mistral-medium-latest",
      "mistral-small-latest",
    ]);
  });
});

describe("LmStudioProvider", () => {
  type Instance = { id: string; config: { context_length: number } };
  const llm = (key: string, max: number, loaded: Instance[] = []) => ({ type: "llm", key, max_context_length: max, loaded_instances: loaded });
  const embedding = { type: "embedding", key: "text-embedding-nomic-embed-text-v1.5", max_context_length: 2048, loaded_instances: [] };

  /** A fake LM Studio 0.4 that loads models when asked. */
  function lmStudio(models: ReturnType<typeof llm>[]) {
    return stubFetch(({ url, body }) => {
      if (url.pathname === "/api/v1/models") return json({ models: [...models, embedding] });
      if (url.pathname === "/api/v1/models/load") {
        const { model, context_length } = body as { model: string; context_length: number };
        models.find((entry) => entry.key === model)!.loaded_instances.push({ id: model, config: { context_length } });
        return json({ type: "llm", instance_id: model, status: "loaded", load_time_seconds: 1 });
      }
      return openaiChat('{"name":"Jane","years":9}');
    });
  }
  const make = (model: string, key: string | null = null) => new LmStudioProvider("http://lmstudio:1234/v1/", key, model, 60_000);

  it("loads a model that isn't loaded with 16,384 tokens of context, once for calls at the same time", async () => {
    const requests = lmStudio([llm("google/gemma-4-e4b", 131_072)]);
    const provider = make("google/gemma-4-e4b");
    await Promise.all([provider.complete({ ...ask, schema: Person }), provider.complete({ ...ask, schema: Person })]);
    const loads = requests.filter((request) => request.url.pathname === "/api/v1/models/load");
    expect(loads.map((request) => request.body)).toEqual([{ model: "google/gemma-4-e4b", context_length: 16_384 }]);
    expect(requests.filter((request) => request.url.pathname === "/v1/chat/completions")).toHaveLength(2);
  });

  it("loads a model with its whole context when that's less", async () => {
    const requests = lmStudio([llm("small/model", 8_192)]);
    await make("small/model").complete(ask);
    expect(requests.find((request) => request.url.pathname === "/api/v1/models/load")?.body).toEqual({ model: "small/model", context_length: 8_192 });
  });

  it("uses a model loaded with enough context as it is, and says how to fix one with too little", async () => {
    const requests = lmStudio([
      llm("roomy/model", 131_072, [{ id: "roomy/model", config: { context_length: 24_064 } }]),
      llm("tight/model", 131_072, [{ id: "tight/model", config: { context_length: 4_096 } }]),
    ]);
    await make("roomy/model").complete(ask);
    const error = await failure(make("tight/model").complete(ask));
    expect(error).toMatchObject({ kind: "config", message: expect.stringContaining("loaded with 4,096 tokens of context, and Dossier needs 16,384") });
    expect(requests.some((request) => request.url.pathname === "/api/v1/models/load")).toBe(false);
    expect(requests.filter((request) => request.url.pathname === "/v1/chat/completions")).toHaveLength(1);
  });

  it("refuses a model it doesn't have, which LM Studio would answer with another one", async () => {
    const requests = lmStudio([llm("google/gemma-4-e4b", 131_072)]);
    expect(await failure(make("no-such-model").complete(ask))).toMatchObject({ kind: "model", message: expect.stringContaining("“no-such-model”") });
    expect(await failure(make(embedding.key).complete(ask))).toMatchObject({ kind: "model" });
    expect(requests.some((request) => request.url.pathname === "/v1/chat/completions")).toBe(false);
  });

  it("turns thinking off for reading tasks, and leaves room for it otherwise", async () => {
    const requests = lmStudio([llm("thinker", 131_072, [{ id: "thinker", config: { context_length: 32_768 } }])]);
    await make("thinker").complete({ ...ask, effort: "low" });
    await make("thinker").complete(ask);
    const chats = requests.filter((request) => request.url.pathname === "/v1/chat/completions").map((request) => request.body);
    expect(chats[0]).toMatchObject({ reasoning_effort: "none", max_tokens: 4096 });
    expect(chats[1]).toMatchObject({ max_tokens: 8192 });
    expect(chats[1]).not.toHaveProperty("reasoning_effort");
  });

  it("leaves thinking only its own room, which fits the context it loads", async () => {
    const models = [llm("thinker", 131_072, [{ id: "thinker", config: { context_length: 16_384 } }])];
    const requests = stubFetch(({ url }) => (url.pathname === "/api/v1/models" ? json({ models }) : thinkingChat("", "length")));
    expect(await failure(make("thinker").complete({ ...ask, schema: Person }))).toMatchObject({ kind: "cut-off" });
    const chats = requests.filter((request) => request.url.pathname === "/v1/chat/completions");
    expect(chats.map((request) => (request.body as { max_tokens: number }).max_tokens)).toEqual([8192]);
  });

  it("lists chat models only, and sends the token to both APIs", async () => {
    const requests = lmStudio([llm("nvidia/nemotron-3-nano-4b", 1_048_576), llm("google/gemma-4-e4b", 131_072)]);
    const provider = make("google/gemma-4-e4b", "lm-token");
    expect(await provider.listModels()).toEqual(["google/gemma-4-e4b", "nvidia/nemotron-3-nano-4b"]);
    await provider.complete(ask);
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual(Array(requests.length).fill("Bearer lm-token"));
  });

  it("works with LM Studio before 0.4, which has only the OpenAI API", async () => {
    const requests = stubFetch(({ url }) =>
      url.pathname === "/api/v1/models"
        ? json({ error: "Unexpected endpoint or method. (GET /api/v1/models)" })
        : url.pathname === "/v1/models"
          ? json({ object: "list", data: [{ id: "old-model", object: "model" }] })
          : openaiChat("Hello!"),
    );
    expect(await make("old-model").listModels()).toEqual(["old-model"]);
    expect(await make("old-model").complete(ask)).toBe("Hello!");
    expect(requests.some((request) => request.url.pathname === "/api/v1/models/load")).toBe(false);
  });

  it("says how to reach LM Studio when nothing listens", async () => {
    stubFetch(refused);
    expect(await failure(make("google/gemma-4-e4b").complete(ask))).toMatchObject({ kind: "unreachable", message: LMSTUDIO_UNREACHABLE });
    expect(await failure(make("google/gemma-4-e4b").listModels())).toMatchObject({ kind: "unreachable", message: LMSTUDIO_UNREACHABLE });
  });
});

describe("LocalProvider", () => {
  it("uses Ollama's own API when the server is Ollama", async () => {
    const requests = stubFetch(({ url }) => (url.pathname === "/api/version" ? json({ version: "0.34.4" }) : ollamaChat("Hi")));
    expect(await new LocalProvider("http://ollama-a:11434/", "qwen2.5:3b", 60_000).complete(ask)).toBe("Hi");
    expect(requests.map((request) => request.url.pathname)).toEqual(["/api/version", "/api/chat"]);
  });

  it("uses the OpenAI-compatible endpoint for llama.cpp and the like", async () => {
    const requests = stubFetch(({ url }) => (url.pathname === "/api/version" ? new Response("Not Found", { status: 404 }) : openaiChat("Hi")));
    expect(await new LocalProvider("http://llamacpp:8080", "local", 60_000).complete(ask)).toBe("Hi");
    expect(requests.map((request) => request.url.pathname)).toEqual(["/api/version", "/v1/chat/completions"]);
  });

  it("isn't fooled by LM Studio, which answers /api/version with a 200 and an error", async () => {
    const requests = stubFetch(({ url }) =>
      url.pathname === "/api/version" ? json({ error: "Unexpected endpoint or method. (GET /api/version)" }) : openaiChat("Hi"),
    );
    expect(await new LocalProvider("http://lmstudio:1234", "google/gemma-4-e4b", 60_000).complete(ask)).toBe("Hi");
    expect(requests.map((request) => request.url.pathname)).toEqual(["/api/version", "/v1/chat/completions"]);
  });

  it("says when nothing is listening", async () => {
    stubFetch(refused);
    const error = await failure(new LocalProvider("http://nothing:11434", "qwen2.5:3b", 60_000).complete(ask));
    expect(error).toMatchObject({ kind: "unreachable", retryable: true });
    expect(error.message).toBe("Couldn't reach the server. Check the address and that it's running.");
  });
});

describe("timeouts and cancelling", () => {
  it("gives up after the provider's timeout", async () => {
    stubFetch(hang);
    const error = await failure(new OllamaProvider("http://ollama:11434", "slow", 50).complete(ask));
    expect(error.kind).toBe("timeout");
  });

  it("stops when the caller cancels", async () => {
    stubFetch(hang);
    const controller = new AbortController();
    const pending = new OllamaProvider("http://ollama:11434", "slow", 60_000).complete({ ...ask, signal: controller.signal });
    controller.abort();
    expect(await failure(pending)).toMatchObject({ kind: "cancelled", retryable: false });
  });
});

describe("test()", () => {
  it("reports the model and how long it took", async () => {
    const result = await new MockProvider({ model: "qwen2.5:3b" }).test();
    expect(result).toEqual({ model: "qwen2.5:3b", latencyMs: expect.any(Number) });
  });

  it("needs a model", async () => {
    expect(await failure(new MockProvider({ model: null }).test())).toMatchObject({
      kind: "config",
      message: "Choose a model in Settings → AI provider first.",
    });
  });
});

describe("MockProvider", () => {
  it("answers from code, records calls and validates JSON like a real provider", async () => {
    const provider = new MockProvider({ reply: (call) => (call.json ? { name: "Jane", years: 9 } : "plain") });
    expect(await provider.complete(ask)).toBe("plain");
    expect(await provider.complete({ ...ask, schema: Person })).toEqual({ name: "Jane", years: 9 });
    expect(provider.calls).toHaveLength(2);
    const wrong = new MockProvider({ reply: () => ({ name: "Jane" }) });
    expect(await failure(wrong.complete({ ...ask, schema: Person }))).toMatchObject({ kind: "invalid-output" });
  });
});

describe("token counts (#290)", () => {
  /** A sink that keeps what it's given. */
  const counted = () => {
    const entries: UsageEntry[] = [];
    return { entries, sink: (entry: UsageEntry) => void entries.push(entry) };
  };
  const completion = (content: string, usage?: unknown, finish_reason = "stop", reasoning?: string) =>
    json({
      id: "c1",
      object: "chat.completion",
      created: 0,
      model: "gpt",
      choices: [{ index: 0, message: { role: "assistant", content, ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason }],
      ...(usage ? { usage } : {}),
    });

  it("passes Ollama's counts on with the task, the provider and the model", async () => {
    stubFetch(() => json({ model: "qwen2.5:3b", message: { role: "assistant", content: "Hi" }, done: true, prompt_eval_count: 120, eval_count: 8 }));
    const { entries, sink } = counted();
    await new OllamaProvider("http://ollama:11434", "qwen2.5:3b", 60_000, sink).complete({ ...ask, task: "write-email" });
    expect(entries).toEqual([{ task: "write-email", provider: "LOCAL", model: "qwen2.5:3b", input: 120, output: 8 }]);
  });

  it("reads an OpenAI-compatible server's usage, and nothing from one that sends none", async () => {
    let call = 0;
    stubFetch(() => (call++ === 0 ? completion("Hi", { prompt_tokens: 50, completion_tokens: 900, total_tokens: 950, completion_tokens_details: { reasoning_tokens: 880 } }) : completion("Hi")));
    const { entries, sink } = counted();
    const provider = new OpenAICompatibleProvider("OPENAI", "https://usage.example/v1", "sk", "gpt-x", 60_000, sink);
    await provider.complete(ask);
    await provider.complete(ask);
    expect(entries).toEqual([
      // The thinking is in the completion tokens.
      { task: "connection-check", provider: "OPENAI", model: "gpt-x", input: 50, output: 900 },
      { task: "connection-check", provider: "OPENAI", model: "gpt-x", input: null, output: null },
    ]);
  });

  it("counts an answer cut off while thinking as well as the one asked again with room", async () => {
    stubFetch(({ body }) =>
      (body as { max_tokens: number }).max_tokens > 4096
        ? completion('{"name":"Jane","years":9}', { prompt_tokens: 60, completion_tokens: 5_000 }, "stop", "Hmm…")
        : completion("", { prompt_tokens: 60, completion_tokens: 4_096 }, "length", "Hmm…"),
    );
    const { entries, sink } = counted();
    await new OpenAICompatibleProvider("OPENAI", "https://usage-thinker.example/v1", "sk", "glm-5", 60_000, sink).complete({ ...ask, schema: Person });
    expect(entries.map(({ input, output }) => [input, output])).toEqual([
      [60, 4_096],
      [60, 5_000],
    ]);
  });

  it("counts both answers when the first didn't match the schema, and still counts answers that end in an error", async () => {
    const answers = ['{"name":"Jane"}', '{"name":"Jane","years":9}'];
    stubFetch(() => completion(answers.shift() ?? "", { prompt_tokens: 40, completion_tokens: 10 }));
    const { entries, sink } = counted();
    const provider = new OpenAICompatibleProvider("OPENAI", "https://usage-retry.example/v1", "sk", "gpt-x", 60_000, sink);
    expect(await provider.complete({ ...ask, schema: Person })).toEqual({ name: "Jane", years: 9 });
    expect(entries).toHaveLength(2);
    // Wrong twice: an error, after two answers that used tokens.
    expect(await failure(provider.complete({ ...ask, schema: Person }))).toMatchObject({ kind: "invalid-output" });
    expect(entries).toHaveLength(4);
  });

  it("counts nothing for a request the server turns down", async () => {
    stubFetch(() => json({ error: { message: "Invalid API key" } }, { status: 401 }));
    const { entries, sink } = counted();
    await failure(new OpenAICompatibleProvider("OPENAI", "https://usage-401.example/v1", "sk", "gpt-x", 60_000, sink).complete(ask));
    expect(entries).toEqual([]);
  });

  it("adds Anthropic's cached input to the input, and counts an answer the model declined", async () => {
    const message = (stop_reason: string) =>
      json({
        id: "m1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: "Hello!" }],
        stop_reason,
        usage: { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 1_000, output_tokens: 50 },
      });
    let call = 0;
    stubFetch(() => message(call++ === 0 ? "end_turn" : "refusal"));
    const { entries, sink } = counted();
    const provider = new AnthropicProvider("https://api.anthropic.com", "sk-ant", "claude-sonnet-5", 60_000, sink);
    await provider.complete({ ...ask, task: "refine-chat" });
    await failure(provider.complete({ ...ask, task: "refine-chat" }));
    expect(entries).toEqual([
      { task: "refine-chat", provider: "ANTHROPIC", model: "claude-sonnet-5", input: 1_210, output: 50 },
      { task: "refine-chat", provider: "ANTHROPIC", model: "claude-sonnet-5", input: 1_210, output: 50 },
    ]);
  });

  it("names Mistral and a local server as the provider", async () => {
    stubFetch(({ url }) => (url.pathname === "/api/version" ? json({ version: "0.34.4" }) : url.pathname === "/api/chat" ? ollamaChat("Hi") : completion("Hi", { prompt_tokens: 7, completion_tokens: 3 })));
    const { entries, sink } = counted();
    await new MistralProvider("https://api.mistral.ai/v1", "key", "mistral-medium-latest", 60_000, sink).complete(ask);
    await new LocalProvider("http://ollama-usage:11434", "qwen2.5:3b", 60_000, sink).complete(ask);
    expect(entries).toEqual([
      { task: "connection-check", provider: "MISTRAL", model: "mistral-medium-latest", input: 7, output: 3 },
      // ollamaChat sends no counts.
      { task: "connection-check", provider: "LOCAL", model: "qwen2.5:3b", input: null, output: null },
    ]);
  });

  it("counts Test connection as a connection check", async () => {
    const { entries, sink } = counted();
    await new MockProvider({ tokens: { input: 20, output: 1 }, onUsage: sink }).test();
    expect(entries).toEqual([{ task: "connection-check", provider: "MOCK", model: "mock-model", input: 20, output: 1 }]);
  });
});
