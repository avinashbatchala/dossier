import { describe, expect, it } from "vitest";

import { SERVERS, apiAddress, ignoresSchemas, serverAt } from "./servers";

describe("apiAddress", () => {
  it("puts the API where each server has it, and leaves other addresses as they are", () => {
    const cases: [string, string][] = [
      ["https://openrouter.ai", "https://openrouter.ai/api/v1"],
      ["https://openrouter.ai/v1/", "https://openrouter.ai/api/v1"],
      ["https://openrouter.ai/api", "https://openrouter.ai/api/v1"],
      ["https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1"],
      ["https://opencode.ai/inference/go/openai/v1", "https://opencode.ai/inference/go/v1"],
      ["https://opencode.ai/inference/go/v1", "https://opencode.ai/inference/go/v1"],
      ["https://opencode.ai/zen/v1", "https://opencode.ai/zen/v1"],
      ["https://api.deepseek.com", "https://api.deepseek.com"],
      ["http://llama:8080/v1/", "http://llama:8080/v1/"],
    ];
    expect(cases.map(([entered]) => [entered, apiAddress(entered)])).toEqual(cases);
  });
});

describe("ignoresSchemas (#276)", () => {
  it("knows Ollama's cloud, and its cloud models through a local Ollama", () => {
    expect(ignoresSchemas("https://ollama.com/v1", "gpt-oss:120b")).toBe(true);
    expect(ignoresSchemas("http://localhost:11434/v1", "deepseek-v3.1:671b-cloud")).toBe(true);
    expect(ignoresSchemas("http://localhost:11434/v1", "qwen2.5:3b")).toBe(false);
    expect(ignoresSchemas("https://api.openai.com/v1", "gpt-5")).toBe(false);
  });
});

describe("serverAt", () => {
  it("knows a server by its domain and subdomains, not by lookalikes", () => {
    expect(serverAt("https://api.deepseek.com/v1")?.name).toBe("DeepSeek");
    expect(serverAt("https://deepseek.com")?.name).toBe("DeepSeek");
    expect(serverAt("https://notdeepseek.com/v1")).toBeUndefined();
    expect(serverAt("https://deepseek.com.example.org/v1")).toBeUndefined();
    expect(serverAt("not an address")).toBeUndefined();
  });

  it("has one entry per domain", () => {
    const domains = SERVERS.map(({ domain }) => domain);
    expect(new Set(domains).size).toBe(domains.length);
  });
});
