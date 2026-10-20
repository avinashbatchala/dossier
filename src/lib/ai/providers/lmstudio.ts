import "server-only";

import type { ReasoningEffort } from "openai/resources/shared";

import { AiError, toAiError } from "../errors";
import type { ChatAnswer, ChatCall } from "../provider";
import { keyGuardedFetch } from "./guarded-fetch";
import { OpenAICompatibleProvider } from "./openai-compatible";

/** The context Dossier's prompts need, as for Ollama. */
export const LMSTUDIO_CONTEXT_TOKENS = 16_384;

/** Room for a model to think before it writes; the thinking counts towards `max_tokens`. */
const THINKING_TOKENS = 4_096;

export const LMSTUDIO_UNREACHABLE =
  "Couldn't reach LM Studio. Check the address, that its server is running (Developer tab), and, with Dossier in Docker, that Serve on Local Network is on.";

/** A model in LM Studio's own list (`GET /api/v1/models`, LM Studio 0.4 and later). */
type LmStudioModel = {
  type: string;
  key: string;
  max_context_length?: number | null;
  loaded_instances?: { id: string; config?: { context_length?: number } }[];
};

// Loads under way, so two calls at once don't load a model twice.
const loading = new Map<string, Promise<void>>();

/**
 * LM Studio (#210), through its OpenAI-compatible endpoint, with its own API
 * for what that one can't do: list only chat models, and load a model with
 * enough context. Asked for a model it doesn't have, LM Studio answers with
 * whichever one is loaded, and it loads a model with its own default context,
 * often 4,096 tokens. So each call checks the model first.
 */
export class LmStudioProvider extends OpenAICompatibleProvider {
  private readonly root: string;
  private readonly api: typeof fetch;

  constructor(
    address: string,
    private readonly apiKey: string | null,
    model: string | null,
    timeoutMs: number,
  ) {
    const root = address.replace(/\/+$/, "").replace(/(\/api)?\/v1$/, "");
    super("LMSTUDIO", `${root}/v1`, apiKey, model, timeoutMs);
    this.root = root;
    this.api = apiKey ? keyGuardedFetch() : fetch;
  }

  protected override async chat(call: ChatCall): Promise<ChatAnswer> {
    try {
      await this.ready(call.model, call.signal);
      const thinking = this.reasoningEffort(call) === "none" ? 0 : THINKING_TOKENS;
      return await super.chat({ ...call, maxTokens: call.maxTokens + thinking });
    } catch (error) {
      throw this.plainly(error, call.model);
    }
  }

  /** Reading tasks don't need long thought: the model answers without thinking first. */
  protected override reasoningEffort(call: ChatCall): ReasoningEffort | undefined {
    return call.effort === "low" ? "none" : undefined;
  }

  protected override async fetchModels(signal: AbortSignal): Promise<string[]> {
    try {
      const models = await this.models(signal);
      // Before 0.4 there's only the OpenAI list, embedding models included.
      if (!models) return await super.fetchModels(signal);
      return models
        .filter((model) => model.type === "llm")
        .map((model) => model.key)
        .sort();
    } catch (error) {
      throw this.plainly(error, this.model ?? "");
    }
  }

  /**
   * Makes sure `model` is one of LM Studio's chat models and loaded with
   * enough context: loads it if it isn't loaded, and says so if it's loaded
   * with too little rather than reloading it under whoever else uses it.
   */
  private async ready(model: string, signal: AbortSignal): Promise<void> {
    const models = await this.models(signal);
    if (!models) return;
    const entry = models.find((candidate) => candidate.key === model || candidate.loaded_instances?.some((instance) => instance.id === model));
    if (!entry || entry.type !== "llm") throw AiError.unknownModel(model);

    const needed = Math.min(LMSTUDIO_CONTEXT_TOKENS, entry.max_context_length || LMSTUDIO_CONTEXT_TOKENS);
    const instances = entry.loaded_instances ?? [];
    if (instances.length > 0) {
      const smallest = Math.min(...instances.map((instance) => instance.config?.context_length ?? needed));
      if (smallest >= needed) return;
      throw AiError.config(
        `LM Studio has “${model}” loaded with ${smallest.toLocaleString("en-US")} tokens of context, and Dossier needs ${needed.toLocaleString("en-US")}. Eject it in LM Studio and Dossier loads it again with enough, or load it yourself with a larger context length.`,
      );
    }

    const key = `${this.root} ${entry.key}`;
    let load = loading.get(key);
    if (!load) {
      load = this.request("/api/v1/models/load", signal, { model: entry.key, context_length: needed })
        .then(() => undefined)
        .finally(() => loading.delete(key));
      loading.set(key, load);
    }
    await load;
  }

  /** LM Studio's own model list, or null from a version without it. */
  private async models(signal: AbortSignal): Promise<LmStudioModel[] | null> {
    const list = (await this.request("/api/v1/models", signal)) as { models?: unknown };
    // Older versions answer an unknown path with 200 and an error.
    return Array.isArray(list?.models) ? (list.models as LmStudioModel[]) : null;
  }

  private async request(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await this.api(`${this.root}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const problem = await response.text().catch(() => "");
      throw Object.assign(new Error(problem.slice(0, 500)), { name: "LmStudioError", status: response.status });
    }
    return response.json().catch(() => null);
  }

  /** "Couldn't reach the server" in LM Studio's terms; everything else as it is. */
  private plainly(error: unknown, model: string): unknown {
    if (error instanceof AiError || signalled(error)) return error;
    const mapped = toAiError(error, { model });
    return mapped.kind === "unreachable" ? new AiError("unreachable", LMSTUDIO_UNREACHABLE, mapped.detail) : error;
  }
}

/** A cancellation or timeout, which the caller maps with what it knows. */
function signalled(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError" || name === "APIUserAbortError" || name === "APIConnectionTimeoutError";
}
