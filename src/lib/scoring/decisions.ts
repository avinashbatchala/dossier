import "server-only";

import { z } from "zod";

import { MAX_POSTING_CHARACTERS } from "@/lib/ai/tasks/prompt-parts";
import { AiError } from "@/lib/ai/errors";
import type { UsageSink } from "@/lib/usage";

import type { FactorAnswers } from "./factors";
import { postingLines } from "./posting-lines";
import { answersFromTyped, engineQuestions, scoringState, type ScoringPosting, type ScoringProfile } from "./questions";
import type { Answer, Question } from "./typesafe";

// OpenAI Decisions as a scoring model (E25-3, public issue 105): it answers
// the engine's typed questions (OpenAI's predicate, choice and score) about
// the posting and one profile, in one request. Adapted from
// MichaelDanCurtis's experimental adapter in his fork of Dossier.

export const DECISIONS_URL = "https://api.openai.com/v1/decisions";
/** The only model Decisions takes. */
const DECISIONS_MODEL = "gpt-6-luna";
export const SCORE_POSTING_DECISIONS_VERSION = "score-posting-decisions@1";

const MESSAGES = {
  auth: "OpenAI didn't accept the key. Check it, and that its project can use the Decisions API, in Settings → Scoring.",
  "rate-limited": "OpenAI is limiting Decisions requests right now. Wait a minute and try again.",
  busy: "OpenAI Decisions is overloaded right now. Try again in a moment.",
  "too-long": "The posting and the profile are more than OpenAI Decisions can read at once. Try a shorter posting.",
  unreachable: "Couldn't reach OpenAI Decisions. Check that the server can reach the internet.",
  timeout: "OpenAI Decisions took too long to answer. Try again.",
  "invalid-output": "OpenAI Decisions didn't answer every scoring question. Try again.",
  provider: "OpenAI Decisions couldn't score this posting. Try again in a moment.",
} as const;

/** A Decisions failure, in words people can act on; `detail` is for the log, never OpenAI's own message, which may echo the request. */
const decisionsError = (kind: keyof typeof MESSAGES, detail?: string) => new AiError(kind, MESSAGES[kind], detail);

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1_000, 4_000];
const MAX_RETRY_AFTER_MS = 10_000;
const TIMEOUT_MS = 60_000;

const content = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** The engine's questions as Decisions takes them, each named; a Noul becomes a predicate with what true and false mean. */
export function decisionsQuestions(questions: Record<string, Question>) {
  return Object.entries(questions).map(([name, question]) => {
    const instructions = content(question.instructions);
    if (question.type === "score") return { type: "score" as const, name, instructions, levels: question.criteria.map((criterion, index) => ({ label: String(index), description: content(criterion) })) };
    if (question.type === "choice")
      return { type: "choice" as const, name, instructions, choices: Object.entries(question.criteria).map(([value, description]) => ({ value, description: content(description) })) };
    const criteria = question.criteria ? `\nTrue: ${content(question.criteria.true)}\nFalse: ${content(question.criteria.false)}` : "";
    return { type: "predicate" as const, name, instructions: `${instructions}${criteria}` };
  });
}

const probability = z.number().min(0).max(1);
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("predicate"), name: z.string().nullable(), probability }),
  z.object({ type: z.literal("choice"), name: z.string().nullable(), choice: z.union([z.string(), z.boolean()]), confidence: probability.optional() }),
  z.object({ type: z.literal("score"), name: z.string().nullable(), score: z.number(), confidence: probability.optional() }),
  z.object({ type: z.literal("refusal"), name: z.string().nullable() }),
]);
const resultSchema = z.object({
  model: z.string(),
  answers: z.array(z.unknown()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
});

/** A question about one line of the posting, "line19Covered": its line's index. */
const LINE_QUESTION = /^line(\d+)(?:Kind|Covered)$/;

/**
 * Decisions' answers as the engine reads them, trusting nothing: every
 * question answered once, by name and of its kind, a choice one of those
 * offered and a score within its levels. A missing or duplicate answer, an
 * unknown choice or a score out of range fails clearly, and so does a
 * refusal of a factor's question. A refused question about one line of the
 * posting leaves that line out (#516): such lines are mostly about age,
 * gender or health, which the score shouldn't weigh anyway.
 */
export function decisionsAnswers(
  raw: unknown,
  questions: Record<string, Question>,
): { model: string; answers: Record<string, Answer>; refusedLines: Set<number>; usage: { input: number | null; output: number | null } } {
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) throw decisionsError("invalid-output", "Decisions answer");
  const answers: Record<string, Answer> = {};
  const refusedLines = new Set<number>();
  for (const item of parsed.data.answers) {
    const answer = answerSchema.safeParse(item);
    if (!answer.success) throw decisionsError("invalid-output", "Decisions answer of an unknown kind");
    const { name } = answer.data;
    if (answer.data.type === "refusal") {
      const line = name !== null && Object.hasOwn(questions, name) ? LINE_QUESTION.exec(name) : null;
      if (!line) throw new AiError("invalid-output", "OpenAI Decisions refused to answer a scoring question. Try again, or score with another model.", `refusal: ${name}`);
      refusedLines.add(Number(line[1]));
      continue;
    }
    if (name === null || !Object.hasOwn(questions, name)) throw decisionsError("invalid-output", `answer to an unknown question: ${name}`);
    if (Object.hasOwn(answers, name)) throw decisionsError("invalid-output", `second answer to ${name}`);
    const question = questions[name];
    if (question.type === "noul" && answer.data.type === "predicate") answers[name] = { type: "noul", noul: answer.data.probability };
    else if (question.type === "choice" && answer.data.type === "choice" && typeof answer.data.choice === "string" && Object.hasOwn(question.criteria, answer.data.choice))
      answers[name] = { type: "choice", choice: answer.data.choice, confidence: answer.data.confidence ?? 1, probabilities: {} };
    else if (question.type === "score" && answer.data.type === "score" && Number.isFinite(answer.data.score) && answer.data.score >= 0 && answer.data.score <= question.criteria.length - 1)
      answers[name] = { type: "score", score: answer.data.score, confidence: answer.data.confidence ?? 1, probabilities: {} };
    else throw decisionsError("invalid-output", `answer to ${name} of the wrong kind or out of range`);
  }
  const lineLeftOut = (name: string) => {
    const line = LINE_QUESTION.exec(name);
    return line !== null && refusedLines.has(Number(line[1]));
  };
  const missing = Object.keys(questions).filter((name) => !Object.hasOwn(answers, name) && !lineLeftOut(name));
  if (missing.length > 0) throw decisionsError("invalid-output", `no answer to ${missing.join(", ")}`);
  const { usage } = parsed.data;
  return { model: parsed.data.model, answers, refusedLines, usage: { input: usage?.input_tokens ?? null, output: usage?.output_tokens ?? null } };
}

/** Waits `ms`, or less when `signal` aborts. */
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export type DecisionsOptions = { key: string; signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number; retryDelaysMs?: readonly number[] };

/**
 * Asks Decisions `questions` about `state`, in one request, with the key only
 * ever sent to OpenAI. Rate limits and overloads are tried again after a
 * wait; anything else fails at once, as an AiError with a message for people.
 */
export async function askDecisions(
  request: { state: unknown; questions: Record<string, Question> },
  { key, signal, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, retryDelaysMs = RETRY_DELAYS_MS }: DecisionsOptions,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const body = JSON.stringify({
    model: DECISIONS_MODEL,
    // input_json takes an object or a list only: a sentence (Test connection's) goes as text.
    input: typeof request.state === "string" ? request.state : [{ role: "user", content: [{ type: "input_json", data: request.state }] }],
    questions: decisionsQuestions(request.questions),
  });
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(DECISIONS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
        body,
        signal: both,
        redirect: "error",
        cache: "no-store",
      });
    } catch (error) {
      if (signal?.aborted) throw AiError.of("cancelled");
      if (timeout.aborted) throw decisionsError("timeout");
      throw decisionsError("unreachable", error instanceof Error ? error.name : undefined);
    }
    if (response.ok) return decisionsAnswers(await response.json().catch(() => null), request.questions);
    const detail = `Decisions ${response.status}`;
    if (RETRYABLE.has(response.status) && attempt < retryDelaysMs.length) {
      const seconds = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await sleep(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : retryDelaysMs[attempt], both);
      if (signal?.aborted) throw AiError.of("cancelled");
      if (timeout.aborted) throw decisionsError("timeout");
      continue;
    }
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw decisionsError("auth", detail);
    if (response.status === 413) throw decisionsError("too-long", detail);
    if (response.status === 429) throw decisionsError("rate-limited", detail);
    throw decisionsError(response.status >= 500 ? "busy" : "provider", detail);
  }
}

/**
 * Scores `posting` against one profile with Decisions, in one request;
 * `scoredWith` names this version and the model. `onUsage` gets its tokens.
 */
export async function scoreWithDecisions(
  posting: ScoringPosting,
  profile: ScoringProfile,
  { onUsage, ...options }: DecisionsOptions & { onUsage?: UsageSink },
): Promise<{ answers: FactorAnswers; scoredWith: string }> {
  const lines = postingLines(posting.description);
  const state = scoringState({ ...posting, description: posting.description.trim().slice(0, MAX_POSTING_CHARACTERS) }, profile);
  const questions = engineQuestions(lines);
  const result = await askDecisions({ state, questions }, options);
  onUsage?.({ task: "score-posting-decisions", provider: "OPENAI_DECISIONS", model: result.model, input: result.usage.input, output: result.usage.output });
  // Which lines, never their text: the posting stays out of the log.
  if (result.refusedLines.size > 0) console.warn(`[scoring] OpenAI Decisions refused lines ${[...result.refusedLines].join(", ")} of the posting; they're left out of the score.`);
  const answers = answersFromTyped(result.answers, lines, (detail) => decisionsError("invalid-output", detail), result.refusedLines);
  return { answers, scoredWith: `${SCORE_POSTING_DECISIONS_VERSION} (${result.model})` };
}
