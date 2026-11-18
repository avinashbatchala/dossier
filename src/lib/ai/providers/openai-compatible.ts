import "server-only";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ReasoningEffort } from "openai/resources/shared";

import type { UsageSink } from "@/lib/usage";

import { AiError, TOO_LONG } from "../errors";
import { BaseProvider, SCHEMA_REFUSED, withJsonSchema, type ChatAnswer, type ChatCall } from "../provider";
import { keyGuardedFetch } from "./guarded-fetch";
import { timedFetch } from "./timed-fetch";
import { apiAddress, ignoresSchemas, serverAt, type Server } from "./servers";

/** How to ask for JSON, strongest first (E6-4). */
const JSON_MODES = ["schema", "object", "prompt"] as const;
type JsonMode = (typeof JSON_MODES)[number];

/** Room for thinking on top of the answer's, as for Anthropic's API; the thinking counts towards `max_tokens`. */
const THINKING_TOKENS = 12_000;

type Quirks = { noTemperature: boolean; maxCompletionTokens: boolean; noEffort: boolean; thinks: boolean; json: JsonMode };

// What each server and model turned out to accept, so it's only learnt once:
// newer OpenAI models refuse `temperature` and `max_tokens`, many compatible
// servers only know `max_tokens`, not all of them do JSON schemas, not every
// model takes a reasoning effort, and some think until the answer has no room.
const quirks = new Map<string, Quirks>();

// Schemas refused as too complex, by server, model and schema name: large
// ones, such as a whole profile, go in the prompt instead while smaller ones
// keep structured output, as with Anthropic's API (#230).
const promptSchemas = new Set<string>();

// A way of asking for JSON refused. OpenRouter answers 404 "No endpoints found
// that support the provided parameters" when none of a model's hosts takes it.
const JSON_REFUSED = /response_format|json_schema|json_object|structured|invalid schema|support the provided parameters/i;

// An answer that didn't fit. OpenAI's newer models, such as gpt-6-luna,
// refuse it with a 400 instead of sending it cut off (public PR 51).
const NO_ROOM = /could not finish the message because max_tokens/i;

/**
 * The answer's text. Some servers, Mistral's among them, send a model that
 * thinks as a list of chunks: the text ones are the answer, the thinking
 * isn't.
 */
function answerText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((chunk: { type?: unknown; text?: unknown }) => (chunk?.type === "text" && typeof chunk.text === "string" ? [chunk.text] : []))
    .join("");
}

/** Whether the model thought before answering, in any of the ways servers report it. */
function hasReasoning(completion: OpenAI.Chat.Completions.ChatCompletion): boolean {
  if ((completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0) > 0) return true;
  const message = completion.choices[0]?.message as unknown as Record<string, unknown> | undefined;
  if (!message) return false;
  if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) return true;
  if (typeof message.reasoning === "string" && message.reasoning.length > 0) return true;
  return Array.isArray(message.content) && message.content.some((chunk: { type?: unknown }) => chunk?.type === "thinking" || chunk?.type === "reasoning");
}

/**
 * What the server said in refusing a call. A gateway's own message can be a
 * bare "Provider returned error", with the model host's words in
 * `metadata.raw`, as OpenRouter's is.
 */
function refusal(error: InstanceType<typeof OpenAI.APIError>): string {
  const raw = (error.error as { metadata?: { raw?: unknown } } | undefined)?.metadata?.raw;
  if (raw === undefined || raw === null) return error.message;
  return `${error.message} ${typeof raw === "string" ? raw : JSON.stringify(raw)}`;
}

/** Any server that speaks the OpenAI chat completions API, including llama.cpp's server. */
export class OpenAICompatibleProvider extends BaseProvider {
  protected readonly client: OpenAI;
  private readonly baseURL: string;
  /** What's different about this server, if it's a known one (servers.ts). */
  private readonly server: Server | undefined;

  constructor(
    readonly kind: "OPENAI" | "LOCAL" | "MISTRAL" | "LMSTUDIO",
    baseURL: string,
    apiKey: string | null,
    model: string | null,
    timeoutMs: number,
    onUsage?: UsageSink,
  ) {
    super(model, timeoutMs, onUsage);
    this.baseURL = apiAddress(baseURL);
    this.server = serverAt(this.baseURL);
    // Local servers often need no key, but the SDK insists on one. It isn't
    // sent, as some servers refuse a made-up one even for a public model list.
    this.client = new OpenAI({
      baseURL: this.baseURL,
      apiKey: apiKey || "not-needed",
      timeout: timeoutMs,
      maxRetries: 1,
      defaultHeaders: { ...(apiKey ? {} : { Authorization: null }), ...this.server?.headers?.() },
      // With a key attached, no redirects to other hosts (E11-5).
      fetch: apiKey ? keyGuardedFetch(timedFetch(timeoutMs)) : timedFetch(timeoutMs),
    });
  }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    const key = `${this.baseURL} ${call.model}`;
    const schemaKey = call.json ? `${key} ${call.json.name}` : "";
    let known: Quirks = quirks.get(key) ?? {
      noTemperature: false,
      maxCompletionTokens: false,
      noEffort: false,
      thinks: false,
      // A server that ignores a schema silently never says so: start where the model can see it.
      json: ignoresSchemas(this.baseURL, call.model) ? "prompt" : "schema",
    };
    // Another way of asking for JSON, tried for this call only (see below).
    let guessed: JsonMode | undefined;
    // A 400 or 422 naming a parameter this model doesn't take, or a gateway's
    // 404 for one: adapt and remember, once per parameter.
    for (;;) {
      const json: JsonMode = promptSchemas.has(schemaKey) ? "prompt" : (guessed ?? known.json);
      try {
        const { answer, reasoned } = await this.send(call, { ...known, json });
        // The thinking used up the room for the answer: ask again with room
        // for both, and leave it from now on.
        if (!answer.cutOff || !reasoned || known.thinks || this.thinkingRoom() === 0) return answer;
        known = { ...known, thinks: true };
        quirks.set(key, known);
      } catch (error) {
        const status = error instanceof OpenAI.APIError ? error.status : undefined;
        const message = error instanceof OpenAI.APIError && (status === 400 || status === 404 || status === 422) ? refusal(error) : "";
        if (call.json && SCHEMA_REFUSED.test(message) && !promptSchemas.has(schemaKey)) {
          promptSchemas.add(schemaKey);
          continue;
        }
        // As with an answer cut off: room for thinking, once, and from then on.
        if (NO_ROOM.test(message)) {
          if (known.thinks || this.thinkingRoom() === 0) throw AiError.of("cut-off");
          known = { ...known, thinks: true };
          quirks.set(key, known);
          continue;
        }
        const jsonRefused = call.json !== undefined && JSON_REFUSED.test(message);
        const adapted: Quirks = {
          noTemperature: known.noTemperature || (call.temperature !== undefined && /temperature/i.test(message)),
          maxCompletionTokens: known.maxCompletionTokens || /max_tokens/.test(message),
          noEffort: known.noEffort || (this.reasoningEffort(call) !== undefined && /reasoning_effort/i.test(message)),
          thinks: known.thinks,
          json: jsonRefused ? (JSON_MODES[JSON_MODES.indexOf(json) + 1] ?? known.json) : known.json,
        };
        if (
          adapted.noTemperature === known.noTemperature &&
          adapted.maxCompletionTokens === known.maxCompletionTokens &&
          adapted.noEffort === known.noEffort &&
          adapted.json === known.json
        ) {
          // Any other 400 or 422 to a call that asked for JSON may still be
          // about that, in words we don't know, or about the model's answer
          // to it: Groq checks the JSON itself and answers 400
          // json_validate_failed when the model gets it wrong (public issue
          // 128). Ask the next simpler way, but only for this call, since
          // the same error can come from something else.
          if (call.json && (status === 400 || status === 422) && json !== "prompt" && !TOO_LONG.test(message)) {
            guessed = JSON_MODES[JSON_MODES.indexOf(json) + 1];
            continue;
          }
          throw error;
        }
        // A refusal we know overrides a guess.
        if (adapted.json !== known.json) guessed = undefined;
        known = adapted;
        quirks.set(key, known);
      }
    }
  }

  /** The `reasoning_effort` to send for `call`, if any; none by default, as servers differ in what they take. */
  protected reasoningEffort(call: ChatCall): ReasoningEffort | undefined {
    void call;
    return undefined;
  }

  /** Tokens added once a model's thinking left its answer no room; none for a provider that makes room itself. */
  protected thinkingRoom(): number {
    return THINKING_TOKENS;
  }

  private async send(
    call: ChatCall,
    { noTemperature, maxCompletionTokens, noEffort, thinks, json }: Quirks,
  ): Promise<{ answer: ChatAnswer; reasoned: boolean }> {
    const effort = noEffort ? undefined : this.reasoningEffort(call);
    const maxTokens = call.maxTokens + (thinks ? this.thinkingRoom() : 0);
    // Without schema support, the schema goes into the instructions instead.
    const system = call.json && json !== "schema" ? withJsonSchema(call.system, call.json.schema) : call.system;
    const responseFormat = !call.json
      ? {}
      : json === "schema"
        ? { response_format: zodResponseFormat(call.json.schema, call.json.name) }
        : json === "object"
          ? { response_format: { type: "json_object" as const } }
          : {};
    const completion = await this.client.chat.completions.create(
      {
        model: call.model,
        messages: [{ role: "system", content: system }, ...call.messages],
        ...(noTemperature || call.temperature === undefined ? {} : { temperature: call.temperature }),
        ...(maxCompletionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        ...(effort ? { reasoning_effort: effort } : {}),
        ...this.server?.chat,
        ...responseFormat,
      },
      { signal: call.signal },
    );
    // Thinking is in the completion tokens. Not every server sends a usage.
    call.used({ input: completion.usage?.prompt_tokens ?? null, output: completion.usage?.completion_tokens ?? null });
    const choice = completion.choices[0];
    // Mistral says `model_length` when the context ran out instead.
    const finish: string | undefined = choice?.finish_reason;
    return {
      answer: { text: answerText(choice?.message?.content), cutOff: finish === "length" || finish === "model_length" },
      reasoned: hasReasoning(completion),
    };
  }

  protected async fetchModels(signal: AbortSignal): Promise<string[]> {
    const ids: string[] = [];
    for await (const model of this.client.models.list({ signal })) ids.push(model.id);
    return ids.sort((a, b) => a.localeCompare(b));
  }
}
