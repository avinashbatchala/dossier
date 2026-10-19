import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError } from "./errors";
import { AnthropicProvider, ANTHROPIC_FALLBACK_MODELS } from "./providers/anthropic";
import { LocalProvider } from "./providers/local";
import { MockProvider } from "./providers/mock";
import { OllamaProvider } from "./providers/ollama";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { hang, json, refused, stubFetch } from "./test-http";

afterEach(() => vi.unstubAllGlobals());

const ask = { system: "Be brief.", messages: [{ role: "user" as const, content: "Hi" }] };
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
});

describe("AnthropicProvider", () => {
  it("sends no temperature, since current models refuse one, and leaves room for thinking", async () => {
    const requests = stubFetch(() => anthropicMessage("Hello!"));
    const provider = new AnthropicProvider("https://api.anthropic.com", "sk-ant", "claude-sonnet-5", 60_000);
    expect(await provider.complete({ ...ask, creativity: "EXPRESSIVE" })).toBe("Hello!");
    expect(requests[0].url.href).toBe("https://api.anthropic.com/v1/messages");
    expect(requests[0].headers.get("x-api-key")).toBe("sk-ant");
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
