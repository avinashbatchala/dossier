import "server-only";

import { z } from "zod";

import { AiError } from "@/lib/ai/errors";
import { env } from "@/lib/env";

// TypeSafe's System One API (#274): typed questions about a `state`, answered
// with scores and probabilities rather than text. Jev is its model. The key
// only ever goes to TypeSafe's own address: redirects are refused.

export const TYPESAFE_URL = "https://api.typesafe.ai";
/** TypeSafe's newest stable Jev; each answer says which version it was. */
export const JEV_MODEL = "jev-latest";

/** An instruction, a level or an option: plain text, or an object when it needs fields. */
type Content = string | Record<string, unknown>;

export type ScoreQuestion = { type: "score"; instructions: Content; criteria: Content[] };
export type NoulQuestion = { type: "noul"; instructions: Content; criteria?: { true: Content; false: Content } };
export type ChoiceQuestion = { type: "choice"; instructions: Content; criteria: Record<string, Content> };
export type Question = ScoreQuestion | NoulQuestion | ChoiceQuestion;

const probabilities = z.record(z.string(), z.number());
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("score"), score: z.number(), confidence: z.number(), probabilities }),
  z.object({ type: z.literal("noul"), noul: z.number() }),
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number(), probabilities }),
]);
const resultSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number() }).partial().optional(),
});

export type Answer = z.infer<typeof answerSchema>;
export type SystemOneResult = z.infer<typeof resultSchema>;

const MESSAGES = {
  auth: "TypeSafe didn't accept the key. Check it in Settings → Scoring.",
  "rate-limited": "TypeSafe is limiting requests right now. Wait a minute and try again.",
  busy: "TypeSafe is overloaded right now. Try again in a moment.",
  "too-long": "The posting and your profile are more than Jev can read at once. Try a shorter posting.",
  unreachable: "Couldn't reach TypeSafe. Check that the server can reach the internet.",
  timeout: "TypeSafe took too long to answer. Try again.",
  "invalid-output": "TypeSafe's answer didn't come back in the expected shape. Try again.",
  provider: "TypeSafe couldn't score this posting. Try again in a moment.",
} as const;

/** A TypeSafe failure, in words people can act on. */
export const typesafeError = (kind: keyof typeof MESSAGES, detail?: string) => new AiError(kind, MESSAGES[kind], detail);
const fail = typesafeError;

/** 429 and 529 are worth a second and a third try (TypeSafe's request rules); 503 alike. */
const RETRYABLE = new Set([429, 503, 529]);
const RETRY_DELAYS_MS = [1_000, 4_000];
const MAX_RETRY_AFTER_MS = 10_000;
const TIMEOUT_MS = 60_000;

/** Waits `ms`, or less when `signal` aborts, before or during the wait. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** How long Retry-After asks to wait, within reason, or the usual delay. */
function retryDelay(response: Response, fallback: number): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : fallback;
}

/** An error answer as an AiError; TypeSafe's own message is never shown, it may echo the request. */
async function errorFor(response: Response): Promise<AiError> {
  const detail = `TypeSafe ${response.status}`;
  switch (response.status) {
    case 401:
    case 403:
      return fail("auth", detail);
    case 413:
      return fail("too-long", detail);
    case 429:
      return fail("rate-limited", detail);
    case 503:
    case 529:
      return fail("busy", detail);
    case 400: {
      const body = await response.text().catch(() => "");
      return body.includes("max_tokens_exceeded") ? fail("too-long", detail) : fail("provider", detail);
    }
  }
  return fail("provider", detail);
}

export type AskOptions = {
  key: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
};

/**
 * Asks Jev `questions` about `state`, in one request. Rate limits and
 * overloads are tried again after a wait; anything else fails at once, as an
 * AiError with a message for people.
 */
export async function askJev(
  request: { state: unknown; questions: Record<string, Question> },
  { key, signal, fetchImpl = fetch, baseUrl = env.DOSSIER_TYPESAFE_TEST_BASE_URL ?? TYPESAFE_URL, timeoutMs = TIMEOUT_MS, retryDelaysMs = RETRY_DELAYS_MS }: AskOptions,
): Promise<SystemOneResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const body = JSON.stringify({ model: JEV_MODEL, ...request });

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json", "user-agent": "Dossier" },
        body,
        signal: both,
        redirect: "error",
        cache: "no-store",
      });
    } catch (error) {
      if (signal?.aborted) throw AiError.of("cancelled");
      if (timeout.aborted) throw fail("timeout");
      throw fail("unreachable", error instanceof Error ? error.name : undefined);
    }

    if (response.ok) {
      const parsed = resultSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw fail("invalid-output", "TypeSafe answer");
      return parsed.data;
    }
    if (!RETRYABLE.has(response.status) || attempt >= retryDelaysMs.length) throw await errorFor(response);
    await sleep(retryDelay(response, retryDelaysMs[attempt]), both);
    if (signal?.aborted) throw AiError.of("cancelled");
    if (timeout.aborted) throw fail("timeout");
  }
}
