import "server-only";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import { BaseProvider, type ChatAnswer, type ChatCall } from "../provider";
import { keyGuardedFetch } from "./guarded-fetch";

/** How to ask for JSON, strongest first (E6-4). */
const JSON_MODES = ["schema", "object", "prompt"] as const;
type JsonMode = (typeof JSON_MODES)[number];

type Quirks = { noTemperature: boolean; maxCompletionTokens: boolean; json: JsonMode };

// What each server and model turned out to accept, so it's only learnt once:
// newer OpenAI models refuse `temperature` and `max_tokens`, many compatible
// servers only know `max_tokens`, and not all of them do JSON schemas.
const quirks = new Map<string, Quirks>();

/** DeepSeek's API, whose models think before answering unless told not to. */
const DEEPSEEK_HOST = /(^|\.)deepseek\.com$/i;

/** Enough for a resume, letter or email, even when the model is verbose. */
const DEEPSEEK_MAX_TOKENS = 8_192;

/** The hostname of a base URL; empty when it can't be parsed. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Any server that speaks the OpenAI chat completions API, including llama.cpp's server. */
export class OpenAICompatibleProvider extends BaseProvider {
  private readonly client: OpenAI;
  private readonly deepseek: boolean;

  constructor(
    readonly kind: "OPENAI" | "LOCAL",
    private readonly baseURL: string,
    apiKey: string | null,
    model: string | null,
    timeoutMs: number,
  ) {
    super(model, timeoutMs);
    this.deepseek = DEEPSEEK_HOST.test(hostOf(baseURL));
    // Local servers often need no key, but the SDK insists on one.
    this.client = new OpenAI({
      baseURL,
      apiKey: apiKey || "not-needed",
      timeout: timeoutMs,
      maxRetries: 1,
      // With a key attached, no redirects to other hosts (E11-5).
      ...(apiKey ? { fetch: keyGuardedFetch() } : {}),
    });
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    const key = `${this.baseURL} ${call.model}`;
    let known: Quirks = quirks.get(key) ?? { noTemperature: false, maxCompletionTokens: false, json: "schema" };
    // A 400 naming a parameter this model doesn't take: adapt and remember,
    // once per parameter.
    for (;;) {
      try {
        return await this.send(call, known);
      } catch (error) {
        const message = error instanceof OpenAI.BadRequestError ? error.message : "";
        const jsonRefused = call.json !== undefined && /response_format|json_schema|json_object|structured/i.test(message);
        const adapted: Quirks = {
          noTemperature: known.noTemperature || (call.temperature !== undefined && /temperature/i.test(message)),
          maxCompletionTokens: known.maxCompletionTokens || /max_tokens/.test(message),
          json: jsonRefused ? (JSON_MODES[JSON_MODES.indexOf(known.json) + 1] ?? known.json) : known.json,
        };
        if (
          adapted.noTemperature === known.noTemperature &&
          adapted.maxCompletionTokens === known.maxCompletionTokens &&
          adapted.json === known.json
        ) {
          throw error;
        }
        known = adapted;
        quirks.set(key, known);
      }
    }
  }

  private async send(call: ChatCall, { noTemperature, maxCompletionTokens, json }: Quirks): Promise<ChatAnswer> {
    // Without schema support, the schema goes into the instructions instead.
    const system =
      call.json && json !== "schema"
        ? `${call.system}\n\nReply with only a JSON object, no other text, that matches this JSON schema:\n${JSON.stringify(z.toJSONSchema(call.json.schema))}`
        : call.system;
    const responseFormat = !call.json
      ? {}
      : json === "schema"
        ? { response_format: zodResponseFormat(call.json.schema, call.json.name) }
        : json === "object"
          ? { response_format: { type: "json_object" as const } }
          : {};
    // DeepSeek thinks before answering unless told not to, and its reasoning
    // counts towards max_tokens. Dossier's tasks don't need that reasoning, and
    // with the 4k default it leaves no room for the answer. Disable it there,
    // and allow a little more output for the longer documents.
    const maxTokens = this.deepseek ? Math.max(call.maxTokens, DEEPSEEK_MAX_TOKENS) : call.maxTokens;
    type CreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
    const body: CreateBody & { thinking?: { type: "disabled" } } = {
      model: call.model,
      messages: [{ role: "system", content: system }, ...call.messages],
      ...(noTemperature || call.temperature === undefined ? {} : { temperature: call.temperature }),
      ...(maxCompletionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      ...responseFormat,
      ...(this.deepseek ? { thinking: { type: "disabled" as const } } : {}),
    };
    const completion = await this.client.chat.completions.create(body, { signal: call.signal });
    const choice = completion.choices[0];
    return { text: choice?.message?.content ?? "", cutOff: choice?.finish_reason === "length" };
  }

  protected async fetchModels(signal: AbortSignal): Promise<string[]> {
    const ids: string[] = [];
    for await (const model of this.client.models.list({ signal })) ids.push(model.id);
    return ids.sort();
  }
}
