import "server-only";

import { toAiError } from "../errors";
import type { AIProvider, CompletionRequest, JsonCompletionRequest } from "../provider";

import { OllamaProvider } from "./ollama";
import { OpenAICompatibleProvider } from "./openai-compatible";

type Flavour = "ollama" | "openai";

// Which API each local server speaks, found out on first use.
const flavours = new Map<string, Flavour>();

/**
 * A model on the user's own hardware (SET-1): Ollama through its own API, or
 * llama.cpp's server (and anything like it) through its OpenAI-compatible
 * endpoint. Asks the server once which one it is: only Ollama answers
 * `GET /api/version` with a version. (LM Studio answers it too, with a 200
 * and an error.)
 */
export class LocalProvider implements AIProvider {
  readonly kind = "LOCAL" as const;
  private readonly host: string;

  constructor(
    host: string,
    readonly model: string | null,
    private readonly timeoutMs: number,
  ) {
    this.host = host.replace(/\/+$/, "").replace(/\/v1$/, "");
  }

  private async delegate(signal?: AbortSignal): Promise<AIProvider> {
    let flavour = flavours.get(this.host);
    if (!flavour) {
      const probe = AbortSignal.timeout(10_000);
      try {
        const response = await fetch(`${this.host}/api/version`, { signal: signal ? AbortSignal.any([signal, probe]) : probe });
        const answer = response.ok ? ((await response.json().catch(() => null)) as { version?: unknown } | null) : null;
        flavour = typeof answer?.version === "string" ? "ollama" : "openai";
      } catch (error) {
        throw toAiError(error, { model: this.model ?? "", cancelled: signal?.aborted, timedOut: probe.aborted });
      }
      flavours.set(this.host, flavour);
    }
    return flavour === "ollama"
      ? new OllamaProvider(this.host, this.model, this.timeoutMs)
      : new OpenAICompatibleProvider("LOCAL", `${this.host}/v1`, null, this.model, this.timeoutMs);
  }

  complete(request: CompletionRequest): Promise<string>;
  complete<T>(request: JsonCompletionRequest<T>): Promise<T>;
  async complete<T>(request: CompletionRequest | JsonCompletionRequest<T>): Promise<string | T> {
    const provider = await this.delegate(request.signal);
    return "schema" in request ? provider.complete(request) : provider.complete(request);
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    return (await this.delegate(signal)).listModels(signal);
  }

  async test(signal?: AbortSignal) {
    return (await this.delegate(signal)).test(signal);
  }
}
