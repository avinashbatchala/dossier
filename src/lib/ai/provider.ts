import { prettifyError, type z } from "zod";

import type { AiProvider as AiProviderKind, Creativity } from "@/generated/prisma/enums";

import { AiError, toAiError } from "./errors";

// One interface for every AI provider (E6-1): a local model through Ollama or
// llama.cpp, LM Studio, any OpenAI-compatible server, Anthropic or Mistral.

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** How much a model that thinks before answering may think; its own default when unset. */
export type Effort = "low" | "medium" | "high";

export type CompletionRequest = {
  system: string;
  messages: ChatMessage[];
  /** SET-3. A temperature where the model accepts one; prompts word it for the rest. */
  creativity?: Creativity;
  /** Where the model can be told; reading tasks don't need long thought. */
  effort?: Effort;
  /** Cancels the call, e.g. when the user leaves or cancels the job. */
  signal?: AbortSignal;
  maxTokens?: number;
};

export type JsonCompletionRequest<T> = CompletionRequest & {
  /** The shape the answer must have; the provider asks for it natively where it can. */
  schema: z.ZodType<T>;
  /** Names the schema for providers that want one, e.g. "extracted_posting". */
  schemaName?: string;
};

export interface AIProvider {
  readonly kind: AiProviderKind | "MOCK";
  /** The configured model, if any. */
  readonly model: string | null;
  /** The model's answer as text. */
  complete(request: CompletionRequest): Promise<string>;
  /** The model's answer as validated JSON. */
  complete<T>(request: JsonCompletionRequest<T>): Promise<T>;
  /** Models the server offers, for the model select in Settings (E6-3). */
  listModels(signal?: AbortSignal): Promise<string[]>;
  /** Sends a tiny prompt and reports how long the answer took (SET-2). */
  test(signal?: AbortSignal): Promise<{ model: string; latencyMs: number }>;
}

/** What a provider implementation gets for one call. */
export type ChatCall = {
  model: string;
  system: string;
  messages: ChatMessage[];
  /** Undefined when the provider shouldn't send one. */
  temperature?: number;
  effort?: Effort;
  /** A JSON schema request, when the task wants structured output. */
  json?: { schema: z.ZodType; name: string };
  maxTokens: number;
  signal: AbortSignal;
};

/** What one chat call got back; `cutOff` when the model hit its token limit mid-answer. */
export type ChatAnswer = { text: string; cutOff: boolean };

/** SET-3 creativity as a sampling temperature. */
export const TEMPERATURES: Record<Creativity, number> = {
  FAITHFUL: 0.2,
  BALANCED: 0.6,
  EXPRESSIVE: 0.9,
};

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Shared behaviour: timeouts, cancellation, error mapping, JSON validation.
 * Implementations only send one chat call and list models.
 */
export abstract class BaseProvider implements AIProvider {
  abstract readonly kind: AiProviderKind | "MOCK";

  constructor(
    readonly model: string | null,
    /** How long one call may take before it's abandoned. */
    protected readonly timeoutMs: number,
  ) {}

  /** Sends one chat call and returns the answer. */
  protected abstract chat(call: ChatCall): Promise<ChatAnswer>;

  protected abstract fetchModels(signal: AbortSignal): Promise<string[]>;

  /** Whether this provider takes a temperature; Anthropic's current models don't. */
  protected acceptsTemperature(): boolean {
    return true;
  }

  complete(request: CompletionRequest): Promise<string>;
  complete<T>(request: JsonCompletionRequest<T>): Promise<T>;
  async complete<T>(request: CompletionRequest | JsonCompletionRequest<T>): Promise<string | T> {
    const model = this.requireModel();
    const schema = "schema" in request ? request.schema : undefined;
    const call = (messages: ChatMessage[]) =>
      this.guard(model, request.signal, (signal) =>
        this.chat({
          model,
          system: request.system,
          messages,
          temperature: request.creativity && this.acceptsTemperature() ? TEMPERATURES[request.creativity] : undefined,
          effort: request.effort,
          json: schema ? { schema, name: ("schemaName" in request && request.schemaName) || "result" } : undefined,
          maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          signal,
        }),
      );

    const answer = await call(request.messages);
    if (!schema) return answer.text;
    // Half a JSON answer can't be valid, and asking again only gets cut off again.
    if (answer.cutOff) throw AiError.of("cut-off");

    // E6-4: an answer that doesn't fit gets one more try, told what was wrong.
    const first = validateJson(answer.text, schema);
    if (first.ok) return first.data;
    const retry = await call([
      ...request.messages,
      { role: "assistant", content: answer.text },
      {
        role: "user",
        content: `That answer didn't match the required JSON format:\n${first.problem}\nReply again with only the corrected JSON, nothing else.`,
      },
    ]);
    if (retry.cutOff) throw AiError.of("cut-off");
    const second = validateJson(retry.text, schema);
    if (second.ok) return second.data;
    throw AiError.of("invalid-output", second.problem.split("\n", 1)[0]);
  }

  listModels(signal?: AbortSignal): Promise<string[]> {
    return this.guard(this.model ?? "", signal, (combined) => this.fetchModels(combined));
  }

  async test(signal?: AbortSignal): Promise<{ model: string; latencyMs: number }> {
    const model = this.requireModel();
    const started = performance.now();
    await this.complete({
      system: "You are a connection check. Answer with the single word OK.",
      messages: [{ role: "user", content: "Are you there?" }],
      maxTokens: 16,
      signal,
    });
    return { model, latencyMs: Math.round(performance.now() - started) };
  }

  private requireModel(): string {
    if (!this.model) throw AiError.config("Choose a model in Settings → AI provider first.");
    return this.model;
  }

  /** Runs `call` with the timeout and the caller's signal, mapping whatever it throws. */
  private async guard<R>(model: string, signal: AbortSignal | undefined, call: (signal: AbortSignal) => Promise<R>): Promise<R> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await call(combined);
    } catch (error) {
      throw toAiError(error, { model, cancelled: signal?.aborted, timedOut: timeout.aborted });
    }
  }
}

/**
 * The JSON in a model's answer: the whole text, a fenced ```json block, or
 * the first complete object or array in it (small models like to add a
 * sentence around it). Throws a SyntaxError when there's none.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Look further.
  }
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // Look further.
    }
  }
  const start = trimmed.search(/[{[]/);
  if (start >= 0) {
    const end = matchingBracket(trimmed, start);
    if (end > start) return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new SyntaxError("No JSON found in the answer.");
}

/** Where the object or array opening at `start` closes, skipping strings; -1 if it doesn't. */
function matchingBracket(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
    } else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

const MAX_PROBLEM_LENGTH = 1_000;

/** Parses and validates an answer; `problem` says what's wrong, in words a model can fix. */
export function validateJson<T>(text: string, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; problem: string } {
  let value: unknown;
  try {
    value = extractJson(text);
  } catch {
    return { ok: false, problem: "The answer wasn't valid JSON." };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, problem: prettifyError(result.error).slice(0, MAX_PROBLEM_LENGTH) };
}
