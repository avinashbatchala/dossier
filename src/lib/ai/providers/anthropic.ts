import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { AiError } from "../errors";
import { BaseProvider, SCHEMA_REFUSED, withJsonSchema, type ChatAnswer, type ChatCall, type Effort } from "../provider";
import { keyGuardedFetch } from "./guarded-fetch";

/** Offered when the model list can't be fetched, e.g. before a key is saved. */
export const ANTHROPIC_FALLBACK_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5"];

/**
 * Current models think before they answer unless told otherwise, and the
 * thinking counts towards `max_tokens`: without room on top, a long think
 * leaves none for the answer.
 */
const THINKING_TOKENS = 12_000;

// The effort levels each server and model takes, looked up once: older
// models, such as Claude Haiku 4.5, refuse the parameter.
const effortLevels = new Map<string, ReadonlySet<Effort>>();

// Schemas the API refused for structured output, by server, model and schema
// name: it caps how complex one may be (union-typed and optional parameters,
// grammar size), so large ones, such as a whole profile, go in the prompt
// instead (#230).
const promptSchemas = new Set<string>();

/** Claude through the Messages API with the user's own key. */
export class AnthropicProvider extends BaseProvider {
  readonly kind = "ANTHROPIC" as const;
  private readonly client: Anthropic | null;

  constructor(
    private readonly baseURL: string,
    apiKey: string | null,
    model: string | null,
    timeoutMs: number,
  ) {
    super(model, timeoutMs);
    // The SDK sends the key as a bearer token since 1.0. The Claude API takes
    // either header, but a gateway at a base URL of the user's own may only
    // read X-Api-Key, as every request before did.
    const keyHeader = { "X-Api-Key": apiKey, Authorization: null };
    this.client = apiKey
      ? new Anthropic({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 1, fetch: keyGuardedFetch(), defaultHeaders: keyHeader })
      : null;
  }

  /** Current Claude models reject `temperature`; creativity is in the prompt's wording instead. */
  protected override acceptsTemperature(): boolean {
    return false;
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    if (!this.client) throw AiError.config("Add your Anthropic API key in Settings → AI provider first.");
    const effort = call.effort && (await this.effortLevels(this.client, call.model, call.signal)).has(call.effort) ? call.effort : undefined;
    const schemaKey = call.json ? `${this.baseURL} ${call.model} ${call.json.name}` : "";
    if (!call.json || promptSchemas.has(schemaKey)) return this.send(this.client, call, effort, false);
    try {
      return await this.send(this.client, call, effort, true);
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError && SCHEMA_REFUSED.test(error.message))) throw error;
      promptSchemas.add(schemaKey);
      return this.send(this.client, call, effort, false);
    }
  }

  /** One request; `structured` asks for `call.json` through output_config, otherwise the schema goes in the prompt. */
  private async send(client: Anthropic, call: ChatCall, effort: Effort | undefined, structured: boolean): Promise<ChatAnswer> {
    const format = call.json && structured ? { format: zodOutputFormat(call.json.schema) } : {};
    const outputConfig = { ...format, ...(effort ? { effort } : {}) };
    const message = await client.messages.create(
      {
        model: call.model,
        max_tokens: call.maxTokens + THINKING_TOKENS,
        system: call.json && !structured ? withJsonSchema(call.system, call.json.schema) : call.system,
        messages: call.messages,
        ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
      },
      { signal: call.signal },
    );
    if (message.stop_reason === "refusal") {
      throw new AiError("provider", "The model declined to answer this one. Try rewording it, or try again.", "refusal");
    }
    return {
      text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
      cutOff: message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded",
    };
  }

  /** The effort levels `model` takes, from the Models API; none when that can't tell. */
  private async effortLevels(client: Anthropic, model: string, signal: AbortSignal): Promise<ReadonlySet<Effort>> {
    const key = `${this.baseURL} ${model}`;
    const known = effortLevels.get(key);
    if (known) return known;
    try {
      const effort = (await client.models.retrieve(model, {}, { signal })).capabilities?.effort;
      const levels = new Set((["low", "medium", "high"] as const).filter((level) => effort?.supported && effort[level].supported));
      effortLevels.set(key, levels);
      return levels;
    } catch (error) {
      if (signal.aborted) throw error;
      // Not remembered: the call goes ahead without an effort, and the next one asks again.
      return new Set();
    }
  }

  protected async fetchModels(signal: AbortSignal): Promise<string[]> {
    if (!this.client) return ANTHROPIC_FALLBACK_MODELS;
    try {
      const ids: string[] = [];
      for await (const model of this.client.models.list({ limit: 100 }, { signal })) ids.push(model.id);
      return ids.length > 0 ? ids : ANTHROPIC_FALLBACK_MODELS;
    } catch (error) {
      if (signal.aborted) throw error;
      return ANTHROPIC_FALLBACK_MODELS;
    }
  }
}
