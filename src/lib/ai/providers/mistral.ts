import "server-only";

import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";

import { AiError } from "../errors";
import type { ChatAnswer, ChatCall } from "../provider";
import { OpenAICompatibleProvider } from "./openai-compatible";

/** Offered before a key is saved. The free plan has these; Large needs a paid one. */
export const MISTRAL_FALLBACK_MODELS = ["ministral-8b-latest", "mistral-medium-latest", "mistral-small-latest"];

/** What Mistral's model list says about a model, besides OpenAI's fields. */
export type MistralModel = Pick<OpenAI.Models.Model, "id"> & {
  capabilities?: { completion_chat?: boolean };
  /** The model's other names; each is listed as a model of its own too. */
  aliases?: string[];
  archived?: boolean;
  /** When the model is retired, if that's planned. */
  deprecation?: string | null;
};

/**
 * Mistral's own API (#206). It speaks OpenAI's chat format; what differs is
 * handled in the base class (answers in chunks, 422s) and here: the effort is
 * Mistral's `reasoning_effort`, the model list needs sorting out, and some
 * refusals mean something else than they would elsewhere.
 */
export class MistralProvider extends OpenAICompatibleProvider {
  constructor(
    baseURL: string,
    private readonly apiKey: string | null,
    model: string | null,
    timeoutMs: number,
  ) {
    super("MISTRAL", baseURL, apiKey, model, timeoutMs);
  }

  protected override async chat(call: ChatCall): Promise<ChatAnswer> {
    if (!this.apiKey) throw AiError.config("Add your Mistral API key in Settings → AI provider first.");
    try {
      return await super.chat(call);
    } catch (error) {
      // A workspace without a plan has a limit of 0: waiting won't help.
      if (error instanceof OpenAI.RateLimitError && error.headers?.get("x-ratelimit-limit-req-minute") === "0") {
        throw AiError.config(
          "Mistral lets this API key make 0 requests a minute, so nothing gets through. Check the plan and limits of its workspace in Mistral's console, then try again.",
        );
      }
      // The key is fine; the plan doesn't include the model.
      if (error instanceof OpenAI.PermissionDeniedError && /subscription|tier/i.test(error.message)) {
        throw new AiError("model", `Your Mistral plan doesn't include “${call.model}”. Pick another model in Settings → AI provider.`, "PermissionDeniedError 403");
      }
      throw error;
    }
  }

  /** Reading tasks don't need long thought: Mistral's models then answer without thinking first. */
  protected override reasoningEffort(call: ChatCall): ReasoningEffort | undefined {
    return call.effort === "low" ? "none" : undefined;
  }

  protected override async fetchModels(signal: AbortSignal): Promise<string[]> {
    if (!this.apiKey) return MISTRAL_FALLBACK_MODELS;
    const cards: MistralModel[] = [];
    for await (const model of this.client.models.list({ signal })) cards.push(model as MistralModel);
    return mistralModelNames(cards);
  }
}

/**
 * One name per chat model, for the model select. Mistral lists every name a
 * model goes by (Mistral Medium has ten); of those, the shortest `-latest`
 * one, or else the shortest. Embedding, OCR and retired models are left out.
 */
export function mistralModelNames(cards: MistralModel[]): string[] {
  const named = new Set<string>();
  const chosen = new Set<string>();
  for (const card of cards) {
    if (named.has(card.id) || card.capabilities?.completion_chat === false || card.archived) continue;
    if (card.deprecation && Date.parse(card.deprecation) <= Date.now()) continue;
    const names = [card.id, ...(card.aliases ?? [])];
    for (const name of names) named.add(name);
    const latest = names.filter((name) => name.endsWith("-latest"));
    chosen.add((latest.length > 0 ? latest : names).reduce((shortest, name) => (name.length < shortest.length ? name : shortest)));
  }
  return [...chosen].sort();
}
